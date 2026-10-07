import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/home";
  }
  return value;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Password e-mails sent from the server use the implicit flow: the session travels in the
  // URL fragment (#access_token=…), which the browser keeps across this redirect.
  if (next.endsWith("/reset-password")) {
    return NextResponse.redirect(`${origin}${next}`);
  }
  const loginPath = next.includes("/staff/") ? "/staff/login" : "/login";
  return NextResponse.redirect(`${origin}${loginPath}?error=auth`);
}
