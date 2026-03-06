"use client";

import { catchError, type ErrorInfo } from "next/error";

// 서버 컴포넌트의 조회 실패(getProduct·getProducts throw)를 페이지 안에서 받는다.
// 운영에서는 서버 오류 메시지가 가려지므로 error.message 대신 고정 문구를 쓴다.
// notFound()는 catchError가 그대로 통과시킨다.
function LoadErrorFallback({ what }: { what: string }, { retry }: ErrorInfo) {
  return (
    <div role="alert" className="alert">
      {what}을 불러오지 못했습니다.
      <span className="mt-1 flex items-center gap-3 text-sm text-muted">
        잠시 뒤 다시 시도해 주세요.
        <button type="button" className="btn" onClick={() => retry()}>다시 시도</button>
      </span>
    </div>
  );
}

export const LoadError = catchError(LoadErrorFallback);
