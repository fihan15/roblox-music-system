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

async function getUniverseInfo(universeId) {
  const url = `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`;

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Roblox games API failed: ${r.status}`);
  }

  const data = await r.json();
  const gameInfo = data?.data?.[0];

  if (!gameInfo) {
    throw new Error("Universe not found");
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

    const secret = req.headers["x-mature-secret"];
    const apiSecret = process.env.API_SECRET;

    if (!apiSecret || secret !== apiSecret) {
      return json(res, 401, {
        allowed: false,
        reason: "bad_secret"
      });
    }

    const whitelist = parseWhitelist();
    const body = req.body || {};

    const universeId = Number(body.universeId || 0);
    const placeId = Number(body.placeId || 0);

    if (!universeId || universeId <= 0) {
      return json(res, 400, {
        allowed: false,
        reason: "invalid_universe_id"
      });
    }

    const gameInfo = await getUniverseInfo(universeId);

    const creator = gameInfo.creator || {};
    const creatorId = Number(creator.id || 0);
    const creatorType = String(creator.type || "");

    let allowed = false;
    let licenseOwnerUserId = 0;
    let groupId = 0;

    if (creatorType === "User") {
      licenseOwnerUserId = creatorId;
      allowed = whitelist.has(creatorId);
    }

    if (creatorType === "Group") {
      groupId = creatorId;

      const ownerUserId = await getGroupOwnerUserId(groupId);
      licenseOwnerUserId = ownerUserId;

      allowed = whitelist.has(ownerUserId);
    }

    return json(res, 200, {
      allowed,
      reason: allowed ? "ok" : "not_whitelisted",

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