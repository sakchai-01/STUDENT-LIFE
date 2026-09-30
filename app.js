(() => {
  const cloudConfig = window.ID_LIFE_CLOUD_CONFIG || {};
  const cloudConfigured = Boolean(
    cloudConfig.supabaseUrl && cloudConfig.supabaseAnonKey,
  );
  const cloudEnabled = Boolean(
    cloudConfigured && window.supabase?.createClient,
  );
  let S = {
    users: {},
    current: null,
    tasks: [],
    friends: [],
  };
  const cloudClient = cloudEnabled
    ? window.supabase.createClient(
        cloudConfig.supabaseUrl,
        cloudConfig.supabaseAnonKey,
      )
    : null;
  let cloudUser = null;
  const $ = (id) => document.getElementById(id),
    today = () => new Date().toISOString().slice(0, 10);
  function age(d) {
    if (!d) return "-";
    let b = new Date(d),
      n = new Date(),
      a = n.getFullYear() - b.getFullYear();
    if (
      n.getMonth() < b.getMonth() ||
      (n.getMonth() == b.getMonth() && n.getDate() < b.getDate())
    )
      a--;
    return a;
  }
  function fmt(d) {
    return d ? d.split("-").reverse().join("/") : "-";
  }
  function show(id) {
    document
      .querySelectorAll(".page")
      .forEach((x) => (x.style.display = "none"));
    $(id).style.display = "block";
    document
      .querySelectorAll("nav button")
      .forEach((x) => x.classList.toggle("active", x.dataset.page == id));
    let t = {
      dashboard: ["OVERVIEW", "ภาพรวม"],
      profile: ["PROFILE", "โปรไฟล์"],
      tasks: ["TIME MANAGEMENT", "เป้าหมาย"],
      community: ["COMMUNITY", "เพื่อนและชุมชน"],
      settings: ["SETTINGS", "ตั้งค่าโปรไฟล์"],
    }[id];
    $("eyebrow").textContent = t[0];
    $("title").textContent = t[1];
  }
  function u() {
    return S.users[S.current];
  }
  function legacyProfile() {
    try {
      return JSON.parse(localStorage.getItem("idLifeV1") || "null")?.users?.[
        "6612247052"
      ];
    } catch {
      return null;
    }
  }
  async function importLegacyProfile(authUser, profile) {
    const legacy = legacyProfile();
    const studentId = authUser.email?.match(
      /^student\.(\d{10})@id-life\.invalid$/i,
    )?.[1];
    if (
      !legacy ||
      !studentId ||
      String(legacy.id) !== studentId ||
      profile.legacy_imported_at
    )
      return profile;

    const sourceId = studentId;
    const { data: existingClaim, error: claimReadError } = await cloudClient
      .from("legacy_imports")
      .select("owner_id")
      .eq("source_public_id", sourceId)
      .maybeSingle();
    if (claimReadError) throw claimReadError;
    if (existingClaim && existingClaim.owner_id !== authUser.id) return profile;

    let ownsClaim = Boolean(existingClaim);
    if (!existingClaim) {
      const { error: claimError } = await cloudClient
        .from("legacy_imports")
        .insert({ source_public_id: sourceId, owner_id: authUser.id });
      if (claimError?.code === "23505") return profile;
      if (claimError) throw claimError;
      ownsClaim = true;
    }

    let uploadedPath = null;
    try {
      const changes = {
        faculty: legacy.faculty || "",
        major: legacy.major || "",
        bio: legacy.bio || "",
        latitude: legacy.latitude,
        longitude: legacy.longitude,
        location_visibility_tier: legacy.tier || 2,
        legacy_imported_at: new Date().toISOString(),
      };

      if (legacy.avatar?.startsWith("data:image/")) {
        const image = await fetch(legacy.avatar).then((response) =>
          response.blob(),
        );
        const path = `${authUser.id}/avatar.jpg`;
        const { error: uploadError } = await cloudClient.storage
          .from("id-life-avatars")
          .upload(path, image, { contentType: image.type, upsert: true });
        if (uploadError) throw uploadError;
        uploadedPath = path;
        changes.avatar_path = path;
      }

      const { data, error } = await cloudClient
        .from("profiles")
        .update(changes)
        .eq("id", authUser.id)
        .is("legacy_imported_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (data) return data;

      const { data: currentProfile, error: reloadError } = await cloudClient
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();
      if (reloadError) throw reloadError;
      return currentProfile;
    } catch (error) {
      if (uploadedPath) {
        await cloudClient.storage
          .from("id-life-avatars")
          .remove([uploadedPath]);
      }
      if (ownsClaim) {
        await cloudClient
          .from("legacy_imports")
          .delete()
          .eq("source_public_id", sourceId)
          .eq("owner_id", authUser.id);
      }
      throw error;
    }
  }
  async function openCloudSession(authUser) {
    const { data: initialProfile, error } = await cloudClient
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();
    if (error) throw error;
    const profile = await importLegacyProfile(authUser, initialProfile);

    const [taskResult, friendResult] = await Promise.all([
      cloudClient
        .from("daily_tasks")
        .select("*")
        .eq("user_id", authUser.id)
        .order("task_date")
        .order("created_at"),
      cloudClient
        .from("friends")
        .select("*")
        .eq("owner_id", authUser.id)
        .order("created_at"),
    ]);
    if (taskResult.error) throw taskResult.error;
    if (friendResult.error) throw friendResult.error;

    let avatar = null;
    if (profile.avatar_path) {
      const { data, error: avatarError } = await cloudClient.storage
        .from("id-life-avatars")
        .createSignedUrl(profile.avatar_path, 3600);
      if (avatarError) throw avatarError;
      avatar = data.signedUrl;
    }

    cloudUser = authUser;
    S.current = authUser.id;
    S.users[authUser.id] = {
      id: profile.public_id,
      studentPrefix: profile.student_prefix,
      firstName: profile.first_name,
      lastName: profile.last_name,
      faculty: profile.faculty,
      major: profile.major,
      bio: profile.bio,
      dob: profile.dob,
      latitude: profile.latitude,
      longitude: profile.longitude,
      tier: profile.location_visibility_tier,
      avatar,
      avatarPath: profile.avatar_path,
    };
    S.tasks = taskResult.data.map((task) => ({
      id: task.id,
      userId: authUser.id,
      name: task.task_name,
      date: task.task_date,
      done: task.is_completed,
    }));
    S.friends = friendResult.data.map((friend) => ({
      id: friend.friend_public_id,
      name: friend.display_name,
      status: friend.status,
      tier: friend.closeness_level,
    }));
    $("auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    render();
  }
  async function updateCloudProfile(changes) {
    const { error } = await cloudClient
      .from("profiles")
      .update(changes)
      .eq("id", cloudUser.id);
    if (error) throw error;
  }
  async function cloudLogin() {
    $("cloudAuthMessage").textContent = "";
    const studentId = $("studentId").value.replace(/\D/g, "");
    const birthDate = $("studentDob").value;
    if (!/^\d{10}$/.test(studentId)) {
      $("cloudAuthMessage").textContent = "กรุณากรอกรหัสนักศึกษา 10 หลัก";
      return;
    }
    if (!birthDate) {
      $("cloudAuthMessage").textContent = "กรุณาเลือกวันเกิด";
      return;
    }
    try {
      const { data, error } = await cloudClient.functions.invoke(
        "student-login",
        {
          body: {
            student_id: studentId,
            student_birth: birthDate,
          },
        },
      );
      if (error) {
        let message = error.message;
        if (error.context?.json) {
          const response = await error.context.json().catch(() => null);
          if (response?.code === "NOT_FOUND") {
            message =
              "ยังไม่ได้ deploy student-login ไปยัง Supabase โปรดรัน `supabase functions deploy student-login`";
          } else if (response?.retry_after_seconds) {
            const seconds = Math.max(
              1,
              Math.ceil(response.retry_after_seconds),
            );
            const wait =
              seconds >= 60
                ? `${Math.ceil(seconds / 60)} นาที`
                : `${seconds} วินาที`;
            message = `${response.error || message} (ลองใหม่ใน ${wait})`;
          } else {
            message = response?.error || response?.message || message;
          }
        } else if (message.includes("Failed to send a request")) {
          message =
            "เชื่อมต่อ student-login ไม่ได้ โปรดตรวจการ deploy Function และการเชื่อมต่อเครือข่าย";
        }
        throw new Error(message);
      }
      if (data?.error || !data?.session) {
        throw new Error(
          data?.error || "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจข้อมูลอีกครั้ง",
        );
      }

      const { data: sessionData, error: sessionError } =
        await cloudClient.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      if (sessionError) throw sessionError;
      await openCloudSession(sessionData.session.user);
    } catch (error) {
      await cloudClient.auth.signOut().catch(() => {});
      $("cloudAuthMessage").textContent =
        error.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่";
    }
  }
  function stats() {
    let a = S.tasks.filter((x) => x.userId == S.current && x.date == today()),
      d = a.filter((x) => x.done).length,
      p = a.length ? Math.round((d / a.length) * 100) : 0;
    return { a, d, p };
  }
  function weeklyProgress() {
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(todayDate);
      day.setUTCDate(todayDate.getUTCDate() - 6 + index);
      const date = day.toISOString().slice(0, 10);
      const tasks = S.tasks.filter((task) => task.date === date);
      return tasks.length
        ? Math.round(
            (tasks.filter((task) => task.done).length / tasks.length) * 100,
          )
        : 0;
    });
  }
  function task(t) {
    return `<div class="task ${t.done ? "done" : ""}"><input type="checkbox" data-t="${t.id}" ${t.done ? "checked" : ""}><span>${esc(t.name)}</span><button data-del="${t.id}">×</button></div>`;
  }
  function esc(x) {
    return String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function render() {
    const x = u();
    const s = stats();
    const n = `${x.studentPrefix || ""}${x.firstName} ${x.lastName}`;
    $("userChip").innerHTML = `<b>${esc(n)}</b><small>ID: ${x.id}</small>`;
    $("topDate").textContent = new Date().toLocaleDateString("th-TH", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    $("hello").textContent = "สวัสดี " + x.firstName + " 👋";
    $("today").textContent = new Date().toLocaleDateString("th-TH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    ["total", "percent"].forEach(
      (id, i) => ($(id).textContent = i ? s.p + "%" : s.a.length),
    );
    $("done").textContent = s.d;
    $("remain").textContent = s.a.length - s.d;
    $("pct").textContent = s.p + "%";
    $("ring").style.background =
      `conic-gradient(#818cf8 ${s.p * 3.6}deg,#374151 0)`;
    $("dashTasks").innerHTML =
      s.a.map(task).join("") || "<p>ยังไม่มีเป้าหมายวันนี้</p>";
    $("tasksList").innerHTML =
      s.a.map(task).join("") ||
      '<div class="card"><p>ยังไม่มีเป้าหมาย</p></div>';
    $("tpct").textContent = s.p + "%";
    $("bar").style.width = s.p + "%";
    const avatar = $("avatar");
    avatar.replaceChildren();
    if (x.avatar) {
      const image = new Image();
      image.src = x.avatar;
      image.alt = `รูปโปรไฟล์ของ ${n}`;
      avatar.append(image);
      avatar.classList.add("has-image");
    } else {
      avatar.textContent = x.firstName[0] || "U";
      avatar.classList.remove("has-image");
    }
    $("avatarRemove").classList.toggle("hidden", !x.avatar);
    $("fullname").textContent = n;
    $("bio").textContent = x.bio || "-";
    $("tags").innerHTML =
      `<span>${esc(x.faculty || "-")}</span> <span>${esc(x.major || "-")}</span>`;
    $("pid").textContent = x.id;
    $("pdob").textContent = fmt(x.dob);
    $("age").textContent = x.dob ? age(x.dob) + " ปี" : "-";
    $("faculty").textContent = x.faculty || "-";
    $("major").textContent = x.major || "-";
    $("lat").textContent = x.latitude ?? "ยังไม่ได้ตั้ง";
    $("lng").textContent = x.longitude ?? "ยังไม่ได้ตั้ง";
    $("sf").value = x.firstName || "";
    $("sl").value = x.lastName || "";
    $("sfa").value = x.faculty || "";
    $("sm").value = x.major || "";
    $("sb").value = x.bio || "";
    $("tier").value = x.tier || 2;
    const week = weeklyProgress();
    $("week").innerHTML = week
      .map((v, i) => `<i style="height:${Math.max(3, v)}%"><b>${v}%</b></i>`)
      .join("");
    $("history").innerHTML = week
      .map((v) => `<i style="height:${v}%"><b>${v}%</b></i>`)
      .join("");
    friends();
  }
  function friends() {
    $("friends").innerHTML =
      S.friends
        .map(
          (f) =>
            `<div><b>${esc(f.name)}</b><br><small>ID: ${f.id} · ${f.status}</small> · ${f.tier == 3 ? "Best Friend" : f.tier == 2 ? "Close Friend" : "Acquaintance"}</div>`,
        )
        .join("") || "<p>ยังไม่มีเพื่อน</p>";
  }
  async function uploadAvatar(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const imageBlob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("สร้างรูปไม่สำเร็จ")),
          "image/jpeg",
          0.82,
        ),
      );
      const path = `${cloudUser.id}/avatar.jpg`;
      const { error: uploadError } = await cloudClient.storage
        .from("id-life-avatars")
        .upload(path, imageBlob, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { error: profileError } = await cloudClient
        .from("profiles")
        .update({ avatar_path: path })
        .eq("id", cloudUser.id);
      if (profileError) throw profileError;

      const { data, error: urlError } = await cloudClient.storage
        .from("id-life-avatars")
        .createSignedUrl(path, 3600);
      if (urlError) throw urlError;
      const user = u();
      user.avatar = data.signedUrl;
      user.avatarPath = path;
      render();
    } catch (error) {
      alert("บันทึกรูปไม่สำเร็จ รูปอาจไม่รองรับหรือพื้นที่จัดเก็บเต็ม");
    } finally {
      $("avatarFile").value = "";
    }
  }
  async function logout() {
    if (cloudUser) {
      try {
        const { error } = await cloudClient.auth.signOut();
        if (error) throw error;
      } catch (error) {
        alert("ออกจากระบบไม่สำเร็จ: " + error.message);
        return;
      }
    }
    S.current = null;
    cloudUser = null;
    S = { users: {}, current: null, tasks: [], friends: [] };
    location.reload();
  }
  $("logout").onclick = logout;
  $("cloudLogin").onclick = cloudLogin;
  document
    .querySelectorAll("nav button,[data-page]")
    .forEach((b) => (b.onclick = () => show(b.dataset.page)));
  $("add").onclick = () => {
    $("modal").classList.remove("hidden");
    $("taskDate").value = today();
  };
  $("taskClose").onclick = () => $("modal").classList.add("hidden");
  $("taskSave").onclick = async () => {
    let n = $("taskName").value.trim(),
      d = $("taskDate").value || today();
    if (!n) return;
    try {
      const { data, error } = await cloudClient
        .from("daily_tasks")
        .insert({ user_id: cloudUser.id, task_name: n, task_date: d })
        .select("*")
        .single();
      if (error) throw error;
      S.tasks.push({
        id: data.id,
        userId: cloudUser.id,
        name: data.task_name,
        date: data.task_date,
        done: data.is_completed,
      });
      $("modal").classList.add("hidden");
      $("taskName").value = "";
      render();
    } catch (error) {
      alert("บันทึกเป้าหมายไม่สำเร็จ: " + error.message);
    }
  };
  document.addEventListener("change", async (e) => {
    if (e.target.dataset.t) {
      const task = S.tasks.find((item) => item.id == e.target.dataset.t);
      if (!task) return;
      try {
        const { error } = await cloudClient
          .from("daily_tasks")
          .update({ is_completed: e.target.checked })
          .eq("id", task.id)
          .eq("user_id", cloudUser.id);
        if (error) throw error;
        task.done = e.target.checked;
        render();
      } catch (error) {
        e.target.checked = !e.target.checked;
        alert("อัปเดตเป้าหมายไม่สำเร็จ: " + error.message);
      }
    }
  });
  document.addEventListener("click", async (e) => {
    if (e.target.dataset.del) {
      try {
        const { error } = await cloudClient
          .from("daily_tasks")
          .delete()
          .eq("id", e.target.dataset.del)
          .eq("user_id", cloudUser.id);
        if (error) throw error;
        S.tasks = S.tasks.filter((task) => task.id != e.target.dataset.del);
        render();
      } catch (error) {
        alert("ลบเป้าหมายไม่สำเร็จ: " + error.message);
      }
    }
  });
  $("save").onclick = async () => {
    let x = u();
    const changes = {
      faculty: $("sfa").value.trim(),
      major: $("sm").value.trim(),
      bio: $("sb").value.trim(),
    };
    try {
      await updateCloudProfile({
        faculty: changes.faculty,
        major: changes.major,
        bio: changes.bio,
      });
      Object.assign(x, changes);
      render();
    } catch (error) {
      alert("บันทึก Profile ไม่สำเร็จ: " + error.message);
    }
  };
  $("avatarUpload").onclick = () => $("avatarFile").click();
  $("avatarFile").onchange = (event) => uploadAvatar(event.target.files[0]);
  $("avatarRemove").onclick = async () => {
    const user = u();
    try {
      await updateCloudProfile({ avatar_path: null });
      if (user.avatarPath) {
        const { error } = await cloudClient.storage
          .from("id-life-avatars")
          .remove([user.avatarPath]);
        if (error) throw error;
      }
      user.avatar = null;
      user.avatarPath = null;
      render();
    } catch (error) {
      alert("ลบรูปไม่สำเร็จ: " + error.message);
    }
  };
  $("loc").onclick = () =>
    navigator.geolocation?.getCurrentPosition(
      async (p) => {
        const location = {
          latitude: +p.coords.latitude.toFixed(6),
          longitude: +p.coords.longitude.toFixed(6),
        };
        try {
          await updateCloudProfile(location);
          Object.assign(u(), location);
          render();
        } catch (error) {
          alert("บันทึกตำแหน่งไม่สำเร็จ: " + error.message);
        }
      },
      () => alert("ไม่สามารถอ่านตำแหน่งได้"),
    );
  $("send").onclick = async () => {
    let id = $("fid").value.replace(/\D/g, "");
    if (!/^\d{10}$/.test(id))
      return ($("friendMsg").textContent = "ID ไม่ถูกต้อง");
    if (id == u().id)
      return ($("friendMsg").textContent = "ส่งให้ตัวเองไม่ได้");
    if (S.friends.some((f) => f.id == id))
      return ($("friendMsg").textContent = "มีรายการนี้แล้ว");
    const friend = {
      owner_id: cloudUser.id,
      friend_public_id: id,
      display_name: "ผู้ใช้ " + id.slice(-4),
      status: "pending",
      closeness_level: 1,
    };
    try {
      const { data, error } = await cloudClient
        .from("friends")
        .insert(friend)
        .select("*")
        .single();
      if (error) throw error;
      S.friends.push({
        id: data.friend_public_id,
        name: data.display_name,
        status: data.status,
        tier: data.closeness_level,
      });
      render();
      $("friendMsg").textContent = "ส่งคำขอแล้ว";
    } catch (error) {
      $("friendMsg").textContent = "ส่งคำขอไม่สำเร็จ: " + error.message;
    }
  };
  $("saveTier").onclick = async () => {
    const user = u();
    const tier = +$("tier").value;
    try {
      await updateCloudProfile({ location_visibility_tier: tier });
      user.tier = tier;
      render();
    } catch (error) {
      alert("บันทึกระดับการแชร์ไม่สำเร็จ: " + error.message);
    }
  };
  async function bootstrap() {
    if (!cloudConfigured) {
      $("cloudLogin").disabled = true;
      $("cloudAuthMessage").textContent =
        "ตั้งค่า Supabase URL และ public anon key ใน cloud-config.js ก่อนใช้งาน";
      return;
    }
    if (!cloudEnabled) {
      $("cloudLogin").disabled = true;
      $("cloudAuthMessage").textContent =
        "โหลด Supabase SDK ไม่สำเร็จ กรุณาตรวจการเชื่อมต่ออินเทอร์เน็ต";
      return;
    }
    $("cloudLogin").disabled = false;
    $("cloudAuthMessage").textContent = "";
    try {
      const { data, error } = await cloudClient.auth.getSession();
      if (error) throw error;
      if (data.session) await openCloudSession(data.session.user);
    } catch (error) {
      await cloudClient.auth.signOut().catch(() => {});
      $("cloudAuthMessage").textContent =
        "เชื่อมต่อบัญชีออนไลน์ไม่สำเร็จ: " + error.message;
    }
  }
  bootstrap();
})();
