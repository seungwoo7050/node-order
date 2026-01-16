"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-client";
import { useTRPC } from "@/lib/trpc";

type UploadUrl = { key: string; uploadUrl: string; expiresIn: number };

export function ProductImageUploader({ productId, hasImage }: { productId: number; hasImage: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { key, uploadUrl } = await authFetch<UploadUrl>(`/products/${productId}/image/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`저장소 업로드 실패(${put.status})`);
      await authFetch(`/products/${productId}/image/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() }),
  });

  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="btn focus-within:outline-2 focus-within:outline-fg">
        {upload.isPending ? "올리는 중…" : hasImage ? "바꾸기" : "올리기"}
        <input
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp"
          data-testid={`image-input-${productId}`}
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
      </label>
      {upload.error && <span role="alert" className="text-[0.82rem] text-danger" data-testid={`image-error-${productId}`}>{upload.error.message}</span>}
    </span>

  );
}