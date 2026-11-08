from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any

import httpx

from citeguard.schemas import MetadataFilter

GRADE_ALLOWED_MAP: dict[str, list[str]] = {
    "A": ["A"],
    "B": ["A", "B"],
    "C": ["A", "B", "C"],
}


@dataclass(frozen=True)
class QdrantPoint:
    point_id: str
    vector: list[float]
    payload: dict[str, Any]


@dataclass(frozen=True)
class QdrantScoredHit:
    point_id: str
    chunk_uid: str
    score: float
    payload: dict[str, Any]


def build_qdrant_filter(filters: MetadataFilter) -> dict[str, Any] | None:
    must: list[dict[str, Any]] = []
    if filters.category:
        must.append({"key": "category", "match": {"value": filters.category}})
    if filters.language:
        must.append({"key": "language", "match": {"value": filters.language}})
    if filters.doc_key:
        must.append({"key": "doc_key", "match": {"value": filters.doc_key}})
    if filters.min_source_grade:
        allowed = GRADE_ALLOWED_MAP.get(filters.min_source_grade, ["A", "B", "C"])
        must.append({"key": "source_grade", "match": {"any": allowed}})
    if not must:
        return None
    return {"must": must}


class QdrantVectorStore:
    """REST client for Qdrant Vector DB supporting collection init, payload filter search, upsert, and stale point purge."""

    def __init__(
        self,
        base_url: str | None = None,
        collection_name: str | None = None,
        timeout_seconds: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("CITEGUARD_QDRANT_URL") or "http://localhost:6333"
        ).rstrip("/")
        self.collection_name = (
            collection_name or os.getenv("CITEGUARD_QDRANT_COLLECTION") or "citeguard_chunks"
        )
        self._timeout = timeout_seconds
        self._transport = transport
        self._collection_ready = False

    async def ensure_collection(self, vector_size: int) -> None:
        if self._collection_ready:
            return
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            check = await client.get(f"/collections/{self.collection_name}")
            if check.status_code == 404:
                create_resp = await client.put(
                    f"/collections/{self.collection_name}",
                    json={
                        "vectors": {
                            "size": vector_size,
                            "distance": "Cosine",
                        }
                    },
                )
                create_resp.raise_for_status()
            else:
                check.raise_for_status()
        self._collection_ready = True

    async def upsert_points(self, points: list[QdrantPoint], vector_size: int) -> int:
        if not points:
            return 0
        await self.ensure_collection(vector_size)
        serialized = [
            {
                "id": pt.point_id,
                "vector": pt.vector,
                "payload": pt.payload,
            }
            for pt in points
        ]
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            resp = await client.put(
                f"/collections/{self.collection_name}/points?wait=true",
                json={"points": serialized},
            )
            resp.raise_for_status()
        return len(points)

    async def delete_points(self, point_ids: list[str]) -> int:
        if not point_ids:
            return 0
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            resp = await client.post(
                f"/collections/{self.collection_name}/points/delete?wait=true",
                json={"points": point_ids},
            )
            if resp.status_code != 404:
                resp.raise_for_status()
        return len(point_ids)

    async def query_similar(
        self,
        query_vector: list[float],
        filters: MetadataFilter,
        limit: int = 10,
    ) -> list[QdrantScoredHit]:
        await self.ensure_collection(len(query_vector))
        body: dict[str, Any] = {
            "query": query_vector,
            "limit": limit,
            "with_payload": True,
        }
        q_filter = build_qdrant_filter(filters)
        if q_filter is not None:
            body["filter"] = q_filter

        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            resp = await client.post(
                f"/collections/{self.collection_name}/points/query",
                json=body,
            )
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

        raw_points: list[dict[str, Any]] = data.get("result", {}).get("points", [])
        hits: list[QdrantScoredHit] = []
        for item in raw_points:
            payload: dict[str, Any] = item.get("payload") or {}
            if (
                filters.effective_after
                and str(payload.get("effective_date", "")) < filters.effective_after
            ):
                continue
            hits.append(
                QdrantScoredHit(
                    point_id=str(item["id"]),
                    chunk_uid=str(payload.get("chunk_uid", "")),
                    score=float(item.get("score", 0.0)),
                    payload=payload,
                )
            )
        return hits


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2, strict=False))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 == 0.0 or n2 == 0.0:
        return 0.0
    return dot / (n1 * n2)


class InMemoryQdrantTransport(httpx.AsyncBaseTransport):
    """Protocol-accurate Qdrant REST transport for deterministic CI tests without external sockets."""

    def __init__(self) -> None:
        self.collections: dict[str, int] = {}
        self.points: dict[str, dict[str, QdrantPoint]] = {}

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        method = request.method.upper()
        parts = [p for p in path.split("/") if p]

        # GET /collections/{name}
        if len(parts) == 2 and parts[0] == "collections" and method == "GET":
            cname = parts[1]
            if cname not in self.collections:
                return httpx.Response(404, json={"status": {"error": "Not found"}})
            return httpx.Response(200, json={"result": {"status": "green"}, "status": "ok"})

        # PUT /collections/{name}
        if len(parts) == 2 and parts[0] == "collections" and method == "PUT":
            cname = parts[1]
            body = json.loads(request.content.decode("utf-8"))
            size = int(body["vectors"]["size"])
            self.collections[cname] = size
            self.points.setdefault(cname, {})
            return httpx.Response(200, json={"result": True, "status": "ok"})

        # PUT /collections/{name}/points
        if len(parts) == 3 and parts[0] == "collections" and parts[2] == "points" and method == "PUT":
            cname = parts[1]
            body = json.loads(request.content.decode("utf-8"))
            bucket = self.points.setdefault(cname, {})
            for pt in body.get("points", []):
                pid = str(pt["id"])
                bucket[pid] = QdrantPoint(
                    point_id=pid,
                    vector=[float(x) for x in pt["vector"]],
                    payload=dict(pt.get("payload") or {}),
                )
            return httpx.Response(200, json={"result": {"status": "completed"}, "status": "ok"})

        # POST /collections/{name}/points/delete
        if (
            len(parts) == 4
            and parts[0] == "collections"
            and parts[2] == "points"
            and parts[3] == "delete"
            and method == "POST"
        ):
            cname = parts[1]
            body = json.loads(request.content.decode("utf-8"))
            bucket = self.points.get(cname, {})
            for pid in body.get("points", []):
                bucket.pop(str(pid), None)
            return httpx.Response(200, json={"result": {"status": "completed"}, "status": "ok"})

        # POST /collections/{name}/points/query
        if (
            len(parts) == 4
            and parts[0] == "collections"
            and parts[2] == "points"
            and parts[3] == "query"
            and method == "POST"
        ):
            cname = parts[1]
            body = json.loads(request.content.decode("utf-8"))
            qvec = [float(x) for x in body["query"]]
            limit = int(body.get("limit", 10))
            qfilter: dict[str, Any] | None = body.get("filter")
            bucket = self.points.get(cname, {})

            scored: list[dict[str, Any]] = []
            for pt in bucket.values():
                if not self._matches_filter(pt.payload, qfilter):
                    continue
                sim = _cosine_similarity(qvec, pt.vector)
                scored.append(
                    {
                        "id": pt.point_id,
                        "score": sim,
                        "payload": pt.payload,
                    }
                )
            scored.sort(key=lambda item: float(item["score"]), reverse=True)
            return httpx.Response(
                200,
                json={"result": {"points": scored[:limit]}, "status": "ok"},
            )

        return httpx.Response(404, json={"status": {"error": f"Unhandled route {method} {path}"}})

    @staticmethod
    def _matches_filter(payload: dict[str, Any], qfilter: dict[str, Any] | None) -> bool:
        if not qfilter:
            return True
        for cond in qfilter.get("must", []):
            key = str(cond["key"])
            match_spec: dict[str, Any] = cond.get("match", {})
            val = payload.get(key)
            if "value" in match_spec and val != match_spec["value"]:
                return False
            if "any" in match_spec and val not in match_spec["any"]:
                return False
        return True
