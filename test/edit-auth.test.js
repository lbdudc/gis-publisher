import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { editAuth, htpasswdLine, EDIT_USER } from "../src/edit-auth.js";

test("htpasswd line uses the SHA scheme nginx understands", () => {
  // sha1("password") in base64
  assert.equal(
    htpasswdLine("x", "password"),
    "x:{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g="
  );
});

test("the password is made once and kept", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gp-auth-"));
  const first = editAuth(folder);
  assert.equal(first.user, EDIT_USER);
  assert.ok(first.password.length >= 12);
  assert.equal(first.htpasswd, htpasswdLine(EDIT_USER, first.password));
  const second = editAuth(folder);
  assert.equal(second.password, first.password);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("a damaged or short saved password is replaced", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gp-auth-"));
  fs.writeFileSync(
    path.join(folder, ".gp-edit-auth.json"),
    '{"password":"abc"}'
  );
  const auth = editAuth(folder);
  assert.notEqual(auth.password, "abc");
  fs.writeFileSync(path.join(folder, ".gp-edit-auth.json"), "not json");
  assert.ok(editAuth(folder).password.length >= 12);
  fs.rmSync(folder, { recursive: true, force: true });
});
