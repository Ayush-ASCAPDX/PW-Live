const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAuthHeader } = require("../middleware/auth");

test("parseAuthHeader extracts token from Bearer header", () => {
  const token = parseAuthHeader("Bearer abc.def.ghi");
  assert.equal(token, "abc.def.ghi");
});

test("parseAuthHeader returns empty string for invalid header", () => {
  assert.equal(parseAuthHeader("Basic xyz"), "");
  assert.equal(parseAuthHeader(""), "");
  assert.equal(parseAuthHeader(), "");
});
