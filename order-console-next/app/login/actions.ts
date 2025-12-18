"use server";

import { signIn } from "@/auth";

export async function signInWithGithub() {
  await signIn("github", { redirectTo: "/auth/github/complete" });
}