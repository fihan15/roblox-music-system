function json(res, status, data) {
  res.status(status).json(data);
}

function parseWhitelist() {
  return new Set(
    String(process.env.WHITELIST_USER_IDS || "")
      .split(",")
      .map(v => Number(v.trim()))
      .filter(v => Number.isFinite(v) && v > 0)
  );
}

function isWhitelistedUser(userId) {
  const whitelist = parseWhitelist();
  return whitelist.has(Number(userId));
}

async function getUniverseInfo(universeId) {
  const url = `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`;

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Roblox games API failed: ${r.status}`);
  }

  const data = await r.json();
  const gameInfo = data?.data?.[0];

  // Jangan throw 500 kalau universe tidak ketemu.
  // Balikin null supaya response tetap rapi.
  if (!gameInfo) {
    return null;
  }

  return gameInfo;
}

async function getGroupOwnerUserId(groupId) {
  const url = `https://groups.roblox.com/v1/groups/${encodeURIComponent(groupId)}`;

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Roblox groups API failed: ${r.status}`);
  }

  const data = await r.json();

  return Number(data?.owner?.userId || 0);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, {
        allowed: false,
        reason: "method_not_allowed"
      });
    }

    const apiSecret = process.env.API_SECRET;
    const requestSecret = req.headers["x-mature-secret"];

    if (!apiSecret || requestSecret !== apiSecret) {
      return json(res, 401, {
        allowed: false,
        reason: "bad_secret"
      });
    }

    const body = req.body || {};

    const universeId = Number(body.universeId || 0);
    const placeId = Number(body.placeId || 0);

    if (!universeId || universeId <= 0) {
      return json(res, 200, {
        allowed: false,
        reason: "invalid_universe_id",
        universeId,
        placeId
      });
    }

    const gameInfo = await getUniverseInfo(universeId);

    if (!gameInfo) {
      return json(res, 200, {
        allowed: false,
        reason: "universe_not_found",
        universeId,
        placeId
      });
    }

    const creator = gameInfo.creator || {};
    const creatorType = String(creator.type || "");
    const creatorId = Number(creator.id || 0);

    let allowed = false;
    let groupId = 0;
    let licenseOwnerUserId = 0;
    let checkMode = "";

    // ===============================
    // MAP OWNER = USER
    // Cek langsung UserId creator map
    // ===============================
    if (creatorType === "User") {
      checkMode = "user_creator";

      licenseOwnerUserId = creatorId;
      allowed = isWhitelistedUser(creatorId);
    }

    // ===============================
    // MAP OWNER = GROUP
    // Cek UserId owner group
    // ===============================
    if (creatorType === "Group") {
      checkMode = "group_owner";

      groupId = creatorId;

      const ownerUserId = await getGroupOwnerUserId(groupId);

      licenseOwnerUserId = ownerUserId;
      allowed = isWhitelistedUser(ownerUserId);
    }

    return json(res, 200, {
      allowed,
      reason: allowed ? "ok" : "not_whitelisted",

      checkMode,

      universeId,
      placeId,

      creatorType,
      creatorId,

      groupId,
      licenseOwnerUserId
    });

  } catch (err) {
    return json(res, 500, {
      allowed: false,
      reason: "server_error",
      error: String(err?.message || err)
    });
  }
}
