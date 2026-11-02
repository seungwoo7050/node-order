"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type CategoryItem = {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  _count?: { products: number; children: number };
};

type CategoryNode = {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  _count?: { products: number; children: number };
  children: CategoryNode[];
};

function buildTree(categories: CategoryItem[]): CategoryNode[] {
  const map = new Map<number, CategoryNode>();
  for (const c of categories) {
    map.set(c.id, { ...c, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const c of categories) {
    const node = map.get(c.id)!;
    if (c.parentId === null) {
      roots.push(node);
    } else {
      const parent = map.get(c.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

export default function AdminCategoriesPage() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<number | null>(null);
  const [editSortOrder, setEditSortOrder] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const { data: categories, isPending } = useQuery<CategoryItem[]>({
    queryKey: ["admin-categories"],
    queryFn: () => authFetch<CategoryItem[]>("/admin/categories"),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) return;
      setError(null);
      await authFetch("/admin/categories", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          parentId: newParentId,
        }),
      });
      setNewName("");
      setNewParentId(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["shop-categories"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "카테고리 생성에 실패했습니다."),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (editingId === null) return;
      setError(null);
      await authFetch(`/admin/categories/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim() || undefined,
          parentId: editParentId,
          sortOrder: Number(editSortOrder) || 0,
        }),
      });
      setEditingId(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["shop-categories"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "카테고리 수정에 실패했습니다."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!confirm("이 카테고리를 삭제하시겠습니까? 소속 상품의 카테고리는 해제됩니다.")) return;
      setError(null);
      await authFetch(`/admin/categories/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      void queryClient.invalidateQueries({ queryKey: ["shop-categories"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "카테고리 삭제에 실패했습니다."),
  });

  const tree = categories ? buildTree(categories) : [];

  const startEdit = (c: CategoryItem) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditParentId(c.parentId);
    setEditSortOrder(c.sortOrder);
  };

  const renderNode = (node: CategoryNode, depth = 0) => {
    const isEditing = editingId === node.id;
    return (
      <li key={node.id} className="space-y-1">
        <div
          className={`flex items-center justify-between rounded p-2.5 text-sm border border-line ${
            depth === 0 ? "bg-surface font-medium" : "bg-bg text-fg ml-4"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs">{"—".repeat(depth)}</span>
            <span className="font-medium text-fg">{node.name}</span>
            <span className="text-xs text-muted">
              (상품 {node._count?.products ?? 0}개)
            </span>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="link-quiet"
                onClick={() => startEdit(node)}
              >
                수정
              </button>
              <button
                type="button"
                className="text-red-500 hover:underline cursor-pointer"
                onClick={() => deleteMutation.mutate(node.id)}
              >
                삭제
              </button>
            </div>
          )}
        </div>

        {isEditing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate();
            }}
            className="my-2 ml-4 rounded border border-line-strong bg-neutral-50 p-3 text-xs grid gap-2 max-w-md"
          >
            <h4 className="font-semibold text-fg">카테고리 수정</h4>
            <label className="grid gap-1">
              <span className="text-muted">이름</span>
              <input
                className="border border-line bg-bg px-2 py-1"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </label>
            <label className="grid gap-1">
              <span className="text-muted">상위 카테고리 (이동)</span>
              <select
                className="border border-line bg-bg px-2 py-1"
                value={editParentId ?? ""}
                onChange={(e) =>
                  setEditParentId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">최상위 (루트)</option>
                {categories
                  ?.filter((c) => c.id !== node.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-muted">정렬 순서</span>
              <input
                type="number"
                className="border border-line bg-bg px-2 py-1"
                value={editSortOrder}
                onChange={(e) => setEditSortOrder(Number(e.target.value))}
              />
            </label>
            <div className="flex gap-2 mt-1">
              <button
                type="submit"
                className="btn btn-sm btn-primary"
                disabled={updateMutation.isPending}
              >
                저장
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingId(null)}
              >
                취소
              </button>
            </div>
          </form>
        )}

        {node.children.length > 0 && (
          <ul className="space-y-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-6">카테고리 관리</h1>

      <AdminOnly>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div>
            <h2 className="label mb-3">카테고리 계층 트리</h2>
            {isPending ? (
              <p className="text-sm text-muted">카테고리를 불러오는 중입니다…</p>
            ) : tree.length === 0 ? (
              <p className="rounded border border-dashed border-line p-6 text-center text-sm text-muted">
                등록된 카테고리가 없습니다. 오른쪽 양식에서 새 카테고리를 추가해 보세요.
              </p>
            ) : (
              <ul data-testid="category-tree" className="space-y-2">
                {tree.map((node) => renderNode(node, 0))}
              </ul>
            )}
          </div>

          <aside className="rounded border border-line bg-neutral-50 p-4">
            <h2 className="label mb-3">새 카테고리 추가</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="grid gap-3 text-xs"
            >
              <label className="grid gap-1">
                <span className="text-muted">카테고리명 *</span>
                <input
                  className="border border-line bg-bg px-2.5 py-1.5 text-sm"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="예: 셔츠, 신발"
                  required
                  disabled={readOnly}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-muted">상위 카테고리 (선택)</span>
                <select
                  className="border border-line bg-bg px-2.5 py-1.5 text-sm"
                  value={newParentId ?? ""}
                  onChange={(e) =>
                    setNewParentId(e.target.value ? Number(e.target.value) : null)
                  }
                  disabled={readOnly}
                >
                  <option value="">최상위 (루트 카테고리)</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              {error && (
                <p role="alert" className="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full mt-2"
                disabled={readOnly || createMutation.isPending || !newName.trim()}
              >
                + 카테고리 등록
              </button>
            </form>
          </aside>
        </div>
      </AdminOnly>
    </main>
  );
}
