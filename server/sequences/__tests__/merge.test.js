import test from "node:test";
import assert from "node:assert/strict";
import { resolveMerge, unknownTokens, extractTokens } from "../merge.js";

test("resolveMerge fills known client/broker tokens", () => {
  const ctx = { client: { name: "Sam Lee", email: "sam@x.com" }, user: { company: "Acme Realty" } };
  assert.equal(resolveMerge("Hi {client.name} from {broker.company}", ctx), "Hi Sam Lee from Acme Realty");
});

test("client.firstName derives from full name", () => {
  assert.equal(resolveMerge("Hi {client.firstName}", { client: { name: "Sam Lee" } }), "Hi Sam");
});

test("unknown / missing tokens render as empty string (never raw)", () => {
  assert.equal(resolveMerge("X{client.bogus}Y", {}), "XY");
  assert.equal(resolveMerge("Hi {client.name}", {}), "Hi ");
});

test("unknownTokens flags non-vocabulary tokens for the validator", () => {
  assert.deepEqual(unknownTokens("{client.name} {client.bogus} {property.addr}").sort(), ["client.bogus", "property.addr"]);
  assert.deepEqual(unknownTokens("{client.name} {broker.email}"), []);
});

test("extractTokens dedupes", () => {
  assert.deepEqual(extractTokens("{client.name} {client.name} {date.today}").sort(), ["client.name", "date.today"]);
});
