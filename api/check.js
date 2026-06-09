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

function normalizeCreatorType(value) {
  const text = String(value || "").toLowerCase();

  if (text.includes("group")) return "Group";
  if (text.includes("user")) return "User";

  return "";
}

async function getUniverseInfo(universeId) {
  const url = `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`;

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Roblox games API failed: ${r.status}`);
  }

  const data = await r.json();
  return data?.data?.[0] || null;
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

async function checkByCreator(creatorType, creatorId) {
  creatorType = normalizeCreatorType(creatorType);
  creatorId = Number(creatorId || 0);

  let allowed = false;
  let groupId = 0;
  let licenseOwnerUserId = 0;
  let checkMode = "";

  if (creatorType === "User") {
    checkMode = "user_creator";
    licenseOwnerUserId = creatorId;
    allowed = isWhitelistedUser(creatorId);
  }

  if (creatorType === "Group") {
    checkMode = "group_owner";
    groupId = creatorId;

    const ownerUserId = await getGroupOwnerUserId(groupId);

    licenseOwnerUserId = ownerUserId;
    allowed = isWhitelistedUser(ownerUserId);
  }

  return {
    allowed,
    checkMode,
    creatorType,
    creatorId,
    groupId,
    licenseOwnerUserId
  };
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

    let source = "roblox_universe_api";
    let creatorType = "";
    let creatorId = 0;

    const gameInfo = universeId > 0 ? await getUniverseInfo(universeId) : null;

    if (gameInfo) {
      const creator = gameInfo.creator || {};

      creatorType = normalizeCreatorType(creator.type);
      creatorId = Number(creator.id || 0);
    } else {
      // Fallback untuk Roblox Studio.
      // Kalau universe belum kebaca oleh Roblox API, tetap cek dari creatorId + creatorType yang dikirim server Roblox.
      source = "studio_payload_fallback";

      creatorType = normalizeCreatorType(body.creatorType);
      creatorId = Number(body.creatorId || 0);
    }

    if (!creatorType || creatorId <= 0) {
      return json(res, 200, {
        allowed: false,
        reason: "invalid_creator_data",

        source,
        universeId,
        placeId,

        creatorType,
        creatorId
      });
    }

    const result = await checkByCreator(creatorType, creatorId);

    return json(res, 200, {
      allowed: result.allowed,
      reason: result.allowed ? "ok" : "not_whitelisted",

      source,
      checkMode: result.checkMode,

      universeId,
      placeId,

      creatorType: result.creatorType,
      creatorId: result.creatorId,

      groupId: result.groupId,
      licenseOwnerUserId: result.licenseOwnerUserId
    });

  } catch (err) {
    return json(res, 500, {
      allowed: false,
      reason: "server_error",
      error: String(err?.message || err)
    });
  }
}
