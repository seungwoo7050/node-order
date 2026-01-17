export type GithubUser = { id: string; login: string };

export async function verifyGithubToken(accessToken: string): Promise<GithubUser | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다");
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";

  const res = await fetch(`${api}/applications/${clientId}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`GitHub 토큰 확인 실패(${res.status})`);
  const body = (await res.json()) as { user: { id: number; login: string } };
  return { id: String(body.user.id), login: body.user.login };
}