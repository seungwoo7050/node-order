from __future__ import annotations

import json
import os
from typing import Any, Protocol

import httpx

from citeguard.schemas import LLMRawOutput, RetrievedChunkItem


class EmbedderProtocol(Protocol):
    @property
    def dimension(self) -> int: ...

    async def embed_batch(self, texts: list[str]) -> list[list[float]]: ...


class ChatGeneratorProtocol(Protocol):
    @property
    def model_name(self) -> str: ...

    async def generate_grounded(
        self, question: str, chunks: list[RetrievedChunkItem]
    ) -> LLMRawOutput: ...


class OllamaEmbedder:
    """Calls local Docker Ollama (/api/embed) to generate neural dense embeddings."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        dimension: int = 384,
        timeout_seconds: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("CITEGUARD_OLLAMA_URL") or "http://localhost:11434"
        ).rstrip("/")
        self.model = model or os.getenv("CITEGUARD_EMBED_MODEL") or "all-minilm"
        self._dimension = dimension
        self._timeout = timeout_seconds
        self._transport = transport
        self.total_api_calls = 0

    @property
    def dimension(self) -> int:
        return self._dimension

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        self.total_api_calls += 1
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            resp = await client.post(
                "/api/embed",
                json={
                    "model": self.model,
                    "input": texts,
                },
            )
            resp.raise_for_status()
            payload: dict[str, Any] = resp.json()
            embeddings: list[list[float]] = payload["embeddings"]
            if embeddings and len(embeddings[0]) != self._dimension:
                self._dimension = len(embeddings[0])
            return embeddings


SYSTEM_PROMPT = (
    "당신은 규정 및 약관 원문 검증 AI(CiteGuard)입니다. "
    "반드시 제공된 [근거 청크] 안의 사실과 숫자만 사용하여 답변하세요. "
    "원문에 있는 숫자(일수, 금액, 수수료, 비율, 시각)를 절대 변경하거나 추측하지 마세요. "
    "인용한 청크의 정확한 chunk_uid와 원문 문장 일부(quote)를 citations 배열에 포함하세요. "
    "제공된 청크만으로 답할 수 없다면 abstained를 true로 설정하세요."
)


class OllamaChatGenerator:
    """Calls local Docker Ollama (/api/chat) with JSON schema enforcement for grounded answers."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float = 45.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("CITEGUARD_OLLAMA_URL") or "http://localhost:11434"
        ).rstrip("/")
        self.model = model or os.getenv("CITEGUARD_CHAT_MODEL") or "qwen2.5:0.5b"
        self._timeout = timeout_seconds
        self._transport = transport

    @property
    def model_name(self) -> str:
        return f"ollama/{self.model}"

    async def generate_grounded(
        self, question: str, chunks: list[RetrievedChunkItem]
    ) -> LLMRawOutput:
        if not chunks:
            return LLMRawOutput(
                answer="검색된 규정 근거가 없어 답변을 보류합니다.",
                abstained=True,
                citations=[],
            )

        context_lines: list[str] = []
        for idx, ch in enumerate(chunks, start=1):
            context_lines.append(
                f"[{idx}] chunk_uid={ch.chunk_uid} | 경로={ch.breadcrumb}\n원문: {ch.raw_content}"
            )
        user_prompt = (
            "다음 [근거 청크]만 참고하여 질문에 답하고 JSON으로 출력하세요.\n\n"
            "[근거 청크]\n"
            + "\n\n".join(context_lines)
            + f"\n\n[질문]\n{question}"
        )

        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            resp = await client.post(
                "/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "format": LLMRawOutput.model_json_schema(),
                    "stream": False,
                    "options": {"temperature": 0.0},
                },
            )
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            raw_content: str = data.get("message", {}).get("content", "{}")
            parsed = json.loads(raw_content)
            return LLMRawOutput.model_validate(parsed)
