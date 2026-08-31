const VISIBILITY_OPTIONS = ["Team", "Private"];

/**
 * An item is visible to a user if it's shared with the team, or if the
 * requesting user is the one who created it.
 */
function isVisible(item, userName) {
  if (!item) return false;
  if (item.visibility !== "Private") return true;
  // Items created before ownership tracking existed have no owner on file.
  // Without a known owner we can't tell who "Private" should apply to, so
  // treat them as visible rather than locking everyone out (including the
  // person who set them to Private).
  if (!item.owner) return true;
  return item.owner === userName;
}

function filterVisible(items, userName) {
  return items.filter((item) => isVisible(item, userName));
}

function sanitizeVisibility(visibility) {
  return visibility === "Private" ? "Private" : "Team";
}

module.exports = { VISIBILITY_OPTIONS, isVisible, filterVisible, sanitizeVisibility };
