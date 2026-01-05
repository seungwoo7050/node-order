"use server";

import { signOut } from "@/auth";

export async function endAuthjsSession() {
  await signOut({ redirect: false });
}
