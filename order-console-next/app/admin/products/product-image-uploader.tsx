"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useTRPC } from "@/lib/trpc";
import { confirmProductImage } from "./actions";
import { useReadOnly } from "./admin-only";

type UploadUrl = { key: string; uploadUrl: string; expiresIn: number };

export function ProductImageUploader({ productId, hasImage }: { productId: number; hasImage: boolean }) {
  const trpc = useTRPC();
  const readOnly = useReadOnly();
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
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) throw new Error("로그인이 필요합니다.");
      let failed = await confirmProductImage(token, productId, key);
      if (failed?.status === 401 && (token = await refreshAccessToken())) failed = await confirmProductImage(token, productId, key);
      if (failed) throw new Error(failed.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.products.pathKey() }),
  });

  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="btn focus-within:outline-2 focus-within:outline-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        {upload.isPending ? "올리는 중…" : hasImage ? "바꾸기" : "올리기"}
        <input
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp"
          data-testid={`image-input-${productId}`}
          disabled={readOnly || upload.isPending}
          aria-describedby={readOnly ? "read-only-note" : undefined}
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
