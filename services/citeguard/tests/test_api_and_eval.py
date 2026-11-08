from __future__ import annotations

import json

import httpx

from citeguard.api import create_app
from citeguard.ollama_client import OllamaChatGenerator, OllamaEmbedder
from citeguard.qdrant_store import InMemoryQdrantTransport, QdrantVectorStore
from citeguard.schemas import LLMRawCitation, LLMRawOutput


def build_test_ollama_embedder() -> OllamaEmbedder:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        vecs: list[list[float]] = []
        for text in body["input"]:
            if "공항철도" in text or "직통열차" in text or "11,000" in text:
                vecs.append([0.92, 0.15, 0.05, 0.05])
            elif "제17조" in text or "7일" in text:
                vecs.append([0.10, 0.90, 0.15, 0.05])
            elif "제18조의2" in text or "15%" in text:
                vecs.append([0.12, 0.85, 0.25, 0.05])
            else:
                vecs.append([0.20, 0.20, 0.80, 0.10])
        return httpx.Response(200, json={"embeddings": vecs})

    return OllamaEmbedder(dimension=4, transport=httpx.MockTransport(handler))


def build_test_ollama_generator(hallucinate: bool = False) -> OllamaChatGenerator:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        user_msg: str = body["messages"][-1]["content"]
        # Extract first chunk_uid from prompt
        uid = "unknown"
        for line in user_msg.splitlines():
            if "chunk_uid=" in line:
                uid = line.split("chunk_uid=")[1].split(" ")[0].strip()
                break

        if hallucinate:
            out = LLMRawOutput(
                answer="직통열차 요금은 성인 19,500원이며 출발 후에도 전액 환불됩니다.",
                abstained=False,
                citations=[
                    LLMRawCitation(
                        chunk_uid=uid,
                        quote="직통열차 성인 운임은 11,000원이며 출발 전 환불 수수료는 무료입니다.",
                    )
                ],
            )
        else:
            out = LLMRawOutput(
                answer="직통열차 성인 운임은 11,000원이며 출발 전 환불 수수료는 무료입니다.",
                abstained=False,
                citations=[
                    LLMRawCitation(
                        chunk_uid=uid,
                        quote="직통열차 성인 운임은 11,000원이며 출발 전 환불 수수료는 무료입니다.",
                    )
                ],
            )
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": out.model_dump_json()}},
        )

    return OllamaChatGenerator(transport=httpx.MockTransport(handler))


async def test_fastapi_end_to_end_sync_search_ask_eval_and_metrics() -> None:
    app = create_app(
        db_url="sqlite:///:memory:",
        embedder=build_test_ollama_embedder(),
        generator=build_test_ollama_generator(hallucinate=False),
        qdrant=QdrantVectorStore(transport=InMemoryQdrantTransport()),
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        health = await client.get("/healthz")
        assert health.status_code == 200

        sync_resp = await client.post(
            "/v1/documents/sync",
            json={
                "doc_key": "arex-rules",
                "title": "공항철도 운송약관",
                "source_url": "https://www.arex.or.kr/terms",
                "category": "transit_policy",
                "language": "ko",
                "source_grade": "A",
                "content": (
                    "# 공항철도 운송약관\n\n"
                    "## 제8조 (직통열차 운임 및 환불)\n"
                    "직통열차 성인 운임은 11,000원이며 출발 전 환불 수수료는 무료입니다.\n"
                ),
            },
        )
        assert sync_resp.status_code == 200
        assert sync_resp.json()["added_chunks"] == 1

        search_resp = await client.post(
            "/v1/search",
            json={
                "query": "직통열차 성인 운임",
                "top_k": 2,
                "mode": "hybrid",
                "filters": {"category": "transit_policy"},
            },
        )
        assert search_resp.status_code == 200
        assert len(search_resp.json()["results"]) == 1

        ask_resp = await client.post(
            "/v1/ask",
            json={
                "question": "공항철도 직통열차 성인 요금은 얼마인가요?",
                "filters": {"category": "transit_policy"},
            },
        )
        assert ask_resp.status_code == 200
        ask_data = ask_resp.json()
        assert ask_data["status"] == "GROUNDED"
        assert "11,000원" in ask_data["answer"]

        eval_resp = await client.post(
            "/v1/eval",
            json={
                "top_k": 3,
                "cases": [
                    {
                        "question": "공항철도 제8조 직통열차 운임",
                        "expected_doc_key": "arex-rules",
                        "expected_clause_or_keyword": "11,000원",
                        "expected_numbers": ["11,000"],
                        "filters": {"category": "transit_policy"},
                    }
                ],
            },
        )
        assert eval_resp.status_code == 200
        eval_data = eval_resp.json()
        assert eval_data["hybrid_recall_at_k"] == 1.0
        assert eval_data["grounding_pass_rate"] == 1.0

        metrics_resp = await client.get("/metrics")
        assert metrics_resp.status_code == 200
        assert 'citeguard_sync_chunks_total{action="added"} 1' in metrics_resp.text
        assert 'citeguard_queries_total{status="GROUNDED"} 2' in metrics_resp.text


async def test_fastapi_ask_intercepts_hallucinating_llm() -> None:
    app = create_app(
        db_url="sqlite:///:memory:",
        embedder=build_test_ollama_embedder(),
        generator=build_test_ollama_generator(hallucinate=True),
        qdrant=QdrantVectorStore(transport=InMemoryQdrantTransport()),
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        await client.post(
            "/v1/documents/sync",
            json={
                "doc_key": "arex-rules",
                "title": "공항철도 운송약관",
                "category": "transit_policy",
                "content": (
                    "# 공항철도 운송약관\n\n"
                    "## 제8조 (직통열차 운임)\n"
                    "직통열차 성인 운임은 11,000원이며 출발 전 환불 수수료는 무료입니다.\n"
                ),
            },
        )
        ask_resp = await client.post(
            "/v1/ask",
            json={"question": "직통열차 성인 운임은?"},
        )
        data = ask_resp.json()
        assert data["status"] == "FALLBACK_EXTRACTIVE"
        assert data["violation"] == "NUMERIC_HALLUCINATION"
        assert "11,000원" in data["answer"]
        assert "19,500원" not in data["answer"]
