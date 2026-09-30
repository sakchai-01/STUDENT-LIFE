import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}


function validBirthDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

async function hashAddress(value: string, secret: string) {
  const input = new TextEncoder().encode(`${secret}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}



Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Login service is not configured" }, 500);
  }

  let body: { student_id?: unknown; student_birth?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }

  const studentId =
    typeof body.student_id === "string" ? body.student_id.trim() : "";
  const birthDate = body.student_birth;
  if (!/^\d{10}$/.test(studentId) || !validBirthDate(birthDate)) {
    return jsonResponse({ error: "กรุณาตรวจรหัสนักศึกษาและวันเกิด" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim();
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedAddress ||
    null;
  const ipHash = await hashAddress(
    address || `student-only:${studentId}`,
    serviceRoleKey,
  );
  const studentRateHash = await hashAddress(
    `student-only:${studentId}`,
    serviceRoleKey,
  );

  if (address) {
    const { data: ipLimits, error: ipLimitError } = await admin.rpc(
      "record_student_login_attempt",
      { p_student_id: "__ip__", p_ip_hash: ipHash },
    );
    if (ipLimitError) {
      console.error("IP login rate limiter failed", ipLimitError);
      return jsonResponse({ error: "ระบบตรวจสอบการเข้าสู่ระบบขัดข้อง" }, 503);
    }
    const ipLimit = Array.isArray(ipLimits) ? ipLimits[0] : ipLimits;
    if (!ipLimit?.allowed) {
      return jsonResponse(
        {
          error: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
          retry_after_seconds: ipLimit?.retry_after_seconds ?? 900,
        },
        429,
      );
    }
  }

  const { data: limits, error: limitError } = await admin.rpc(
    "record_student_login_attempt",
    { p_student_id: studentId, p_ip_hash: studentRateHash },
  );
  if (limitError) {
    console.error("Login rate limiter failed", limitError);
    return jsonResponse({ error: "ระบบตรวจสอบการเข้าสู่ระบบขัดข้อง" }, 503);
  }
  const limit = Array.isArray(limits) ? limits[0] : limits;
  if (!limit?.allowed) {
    return jsonResponse(
      {
        error: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
        retry_after_seconds: limit?.retry_after_seconds ?? 900,
      },
      429,
    );
  }

  const { data: student, error: studentError } = await admin
    .from("students")
    .select("student_id")
    .eq("student_id", studentId)
    .eq("student_birth", birthDate)
    .maybeSingle();
  if (studentError) {
    console.error("Student lookup failed", studentError);
    return jsonResponse({ error: "ระบบตรวจสอบการเข้าสู่ระบบขัดข้อง" }, 503);
  }
  if (!student) {
    return jsonResponse(
      { error: "เข้าสู่ระบบไม่สำเร็จ: รหัสนักศึกษาหรือวันเกิดไม่ถูกต้อง" },
      401,
    );
  }

  const { error: resetError } = await admin.rpc("clear_student_login_attempt", {
    p_student_id: studentId,
    p_ip_hash: studentRateHash,
  });
  if (resetError) {
    console.error("Login rate limiter reset failed", resetError);
  }
  if (address) {
    await admin.rpc("clear_student_login_attempt", {
      p_student_id: "__ip__",
      p_ip_hash: ipHash,
    });
  }

  const email = `student.${studentId}@id-life.invalid`;
  const password = birthDate.split("-").reverse().join("");
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("public_id", studentId)
    .maybeSingle();
  if (profileError) {
    console.error("Student profile lookup failed", profileError);
    return jsonResponse({ error: "ระบบตรวจสอบการเข้าสู่ระบบขัดข้อง" }, 503);
  }

  let userId = profile?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error("Student account provisioning failed", error);
      return jsonResponse({ error: "ไม่สามารถเปิดบัญชีสำหรับรหัสนี้ได้" }, 503);
    }
    userId = data.user.id;
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error) {
      console.error("Student credential sync failed", error);
      return jsonResponse({ error: "ไม่สามารถตรวจสอบบัญชีนี้ได้" }, 503);
    }
  }

  const { data: authData, error: authError } =
    await client.auth.signInWithPassword({ email, password });
  if (authError || !authData.session) {
    console.error("Student session creation failed", authError);
    return jsonResponse({ error: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่" }, 401);
  }

  return jsonResponse({ session: authData.session });
});
