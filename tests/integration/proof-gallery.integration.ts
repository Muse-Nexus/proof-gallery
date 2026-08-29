import assert from "node:assert/strict";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required; run \`supabase status -o env\``);
  return value;
}

const apiUrl = required(
  process.env.API_URL ?? process.env.SUPABASE_URL,
  "API_URL",
);
const anonKey = required(
  process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
  "ANON_KEY",
);
const serviceRoleKey = required(
  process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  "SERVICE_ROLE_KEY",
);

const parsedApiUrl = new URL(apiUrl);
assert.ok(
  ["127.0.0.1", "localhost"].includes(parsedApiUrl.hostname) &&
    parsedApiUrl.port === "54321",
  "Integration tests are destructive fixtures and run only against local Supabase at port 54321",
);

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const admin = createClient(apiUrl, serviceRoleKey, clientOptions);
const anonymous = createClient(apiUrl, anonKey, clientOptions);

type SignedIn = {
  client: SupabaseClient;
  user: User;
};

async function createSignedInUser(label: string): Promise<SignedIn> {
  const nonce = crypto.randomUUID();
  const email = `proof-${label}-${nonce}@example.invalid`;
  const password = `Proof-${nonce}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  assert.ok(created.data.user);

  const client = createClient(apiUrl, anonKey, clientOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.equal(signedIn.data.user?.id, created.data.user.id);
  return { client, user: created.data.user };
}

const privatePaths: string[] = [];
const createdUsers: string[] = [];

const fixtureProof = (userId: string) => ({
  user_id: userId,
  title: "A client trusted the finished release",
  evidence_text:
    'The synthetic client wrote: "We trusted you to finish and ship this release."',
  occurred_on: "2026-01-17",
  category: "competence",
  source: "Synthetic client email - fixture only",
  provenance: { kind: "synthetic_fixture", fixture: true },
  tags: ["trusted", "shipped"],
  person: "Synthetic client",
  project: "Fixture release",
  visibility: "personal",
});

try {
  const ownerA = await createSignedInUser("owner-a");
  const ownerB = await createSignedInUser("owner-b");
  createdUsers.push(ownerA.user.id, ownerB.user.id);

  const insertedA = await ownerA.client
    .from("proof_items")
    .insert(fixtureProof(ownerA.user.id))
    .select("*")
    .single();
  assert.ifError(insertedA.error);
  assert.equal(insertedA.data.visibility, "personal");
  const proofAId = insertedA.data.id as string;

  const updatedA = await ownerA.client
    .from("proof_items")
    .update({
      evidence_text:
        'The synthetic client wrote: "We trusted you to finish and ship this release."',
      source: "Synthetic client email - fixture only",
    })
    .eq("id", proofAId)
    .select("id,evidence_text,source,occurred_on")
    .single();
  assert.ifError(updatedA.error);
  assert.equal(updatedA.data.occurred_on, "2026-01-17");
  assert.equal(updatedA.data.source, "Synthetic client email - fixture only");

  const insertedB = await ownerB.client
    .from("proof_items")
    .insert({
      ...fixtureProof(ownerB.user.id),
      title: "Owner B private fixture",
      evidence_text: "This must never appear for owner A.",
      occurred_on: "2025-12-03",
    })
    .select("id")
    .single();
  assert.ifError(insertedB.error);
  const proofBId = insertedB.data.id as string;

  const bReadsA = await ownerB.client
    .from("proof_items")
    .select("id")
    .eq("id", proofAId);
  assert.ifError(bReadsA.error);
  assert.deepEqual(bReadsA.data, []);

  const bUpdatesA = await ownerB.client
    .from("proof_items")
    .update({ title: "cross-owner overwrite" })
    .eq("id", proofAId)
    .select("id");
  assert.ifError(bUpdatesA.error);
  assert.deepEqual(bUpdatesA.data, []);

  const bDeletesA = await ownerB.client
    .from("proof_items")
    .delete()
    .eq("id", proofAId)
    .select("id");
  assert.ifError(bDeletesA.error);
  assert.deepEqual(bDeletesA.data, []);

  const bSpoofsA = await ownerB.client
    .from("proof_items")
    .insert(fixtureProof(ownerA.user.id));
  assert.ok(bSpoofsA.error, "owner B must not insert a row for owner A");

  const anonRead = await anonymous.from("proof_items").select("id");
  assert.ok(anonRead.error, "anonymous table reads must be denied");

  const invalidNullTag = await ownerA.client.from("proof_items").insert({
    ...fixtureProof(ownerA.user.id),
    tags: [null],
  });
  assert.ok(invalidNullTag.error, "NULL tag elements must be rejected");

  const invalidNestedTags = await ownerA.client.from("proof_items").insert({
    ...fixtureProof(ownerA.user.id),
    tags: [["nested"]],
  });
  assert.ok(invalidNestedTags.error, "nested tag arrays must be rejected");

  const categoryFilter = await ownerA.client
    .from("proof_items")
    .select("id,category,tags")
    .eq("category", "competence")
    .contains("tags", ["trusted"]);
  assert.ifError(categoryFilter.error);
  const categoryRows = (categoryFilter.data ?? []) as Array<{ id: string }>;
  assert.deepEqual(categoryRows.map((row) => row.id), [proofAId]);

  const lexical = await ownerA.client.rpc("search_proof_items", {
    p_query: "trusted finish ship release",
    p_limit: 6,
    p_category: "competence",
    p_tags: ["trusted"],
  });
  assert.ifError(lexical.error);
  const lexicalRows = (lexical.data ?? []) as Array<{
    id: string;
    occurred_on: string | null;
    source: string | null;
  }>;
  assert.ok(lexicalRows.some((row) => row.id === proofAId));
  assert.ok(!lexicalRows.some((row) => row.id === proofBId));
  const lexicalA = lexicalRows.find((row) => row.id === proofAId);
  assert.equal(lexicalA?.occurred_on, "2026-01-17");
  assert.equal(lexicalA?.source, "Synthetic client email - fixture only");

  const partialReceipt = await ownerA.client
    .from("proof_items")
    .update({
      embedding: "[1,0,0]",
      embedding_model: null,
      embedding_dimensions: null,
    })
    .eq("id", proofAId);
  assert.ok(
    partialReceipt.error,
    "a vector without its model and dimensions must be rejected",
  );

  const zeroVector = await ownerA.client
    .from("proof_items")
    .update({
      embedding: "[0,0,0]",
      embedding_model: "integration-fixture-v1",
      embedding_dimensions: 3,
    })
    .eq("id", proofAId);
  assert.ok(zeroVector.error, "zero vectors must be rejected");

  const validVector = await ownerA.client
    .from("proof_items")
    .update({
      embedding: "[1,0,0]",
      embedding_model: "integration-fixture-v1",
      embedding_dimensions: 3,
    })
    .eq("id", proofAId)
    .select("id")
    .single();
  assert.ifError(validVector.error);

  const mixedDimension = await ownerA.client
    .from("proof_items")
    .insert({
      ...fixtureProof(ownerA.user.id),
      title: "Mixed dimension fixture",
      category: "creativity",
      tags: ["mixed-dimension"],
      embedding: "[1,0,0,0]",
      embedding_model: "integration-fixture-v1",
      embedding_dimensions: 4,
    })
    .select("id")
    .single();
  assert.ifError(mixedDimension.error);

  const semantic = await ownerA.client.rpc("match_proof_items", {
    query_embedding: "[1,0,0]",
    query_model: "integration-fixture-v1",
    query_dimensions: 3,
    match_threshold: 0.2,
    match_count: 6,
    match_category: null,
    match_tags: null,
  });
  assert.ifError(semantic.error);
  const semanticRows = (semantic.data ?? []) as Array<{ id: string }>;
  assert.deepEqual(semanticRows.map((row) => row.id), [proofAId]);

  const zeroQuery = await ownerA.client.rpc("match_proof_items", {
    query_embedding: "[0,0,0]",
    query_model: "integration-fixture-v1",
    query_dimensions: 3,
    match_threshold: 0.2,
    match_count: 6,
    match_category: null,
    match_tags: null,
  });
  assert.ifError(zeroQuery.error);
  assert.deepEqual(zeroQuery.data, []);

  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
    0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73,
    68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137,
    153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  const privatePath = `${ownerA.user.id}/fixture.png`;
  privatePaths.push(privatePath);
  const uploaded = await ownerA.client.storage
    .from("proof-images")
    .upload(privatePath, png, { contentType: "image/png", upsert: false });
  assert.ifError(uploaded.error);

  const linkedImage = await ownerA.client
    .from("proof_items")
    .update({ image_path: privatePath })
    .eq("id", proofAId)
    .select("image_path")
    .single();
  assert.ifError(linkedImage.error);
  assert.equal(linkedImage.data.image_path, privatePath);

  const aDownload = await ownerA.client.storage
    .from("proof-images")
    .download(privatePath);
  assert.ifError(aDownload.error);
  assert.ok(aDownload.data);

  const bDownload = await ownerB.client.storage
    .from("proof-images")
    .download(privatePath);
  assert.ok(bDownload.error, "owner B must not download owner A's image");

  const bListsA = await ownerB.client.storage
    .from("proof-images")
    .list(ownerA.user.id);
  assert.ifError(bListsA.error);
  assert.deepEqual(bListsA.data, []);

  const bUploadsToA = await ownerB.client.storage
    .from("proof-images")
    .upload(`${ownerA.user.id}/spoof.png`, png, {
      contentType: "image/png",
      upsert: false,
    });
  assert.ok(
    bUploadsToA.error,
    "owner B must not upload into owner A's folder",
  );

  const edgeSearch = await ownerA.client.functions.invoke("proof-search", {
    body: {
      query: "trusted finish ship release",
      category: "competence",
      tag: "trusted",
      limit: 6,
    },
  });
  assert.ifError(edgeSearch.error);
  assert.equal(edgeSearch.data.semantic_degraded, true);
  assert.equal(edgeSearch.data.items[0].id, proofAId);
  assert.equal(edgeSearch.data.items[0].occurred_on, "2026-01-17");
  assert.equal(
    edgeSearch.data.items[0].source,
    "Synthetic client email - fixture only",
  );

  const edgeIndex = await ownerA.client.functions.invoke("embed-proof", {
    body: { id: proofAId },
  });
  assert.ifError(edgeIndex.error);
  assert.deepEqual(edgeIndex.data, {
    semantic_ready: false,
    reason: "not_configured",
  });

  const deletedA = await ownerA.client
    .from("proof_items")
    .delete()
    .eq("id", proofAId)
    .select("id")
    .single();
  assert.ifError(deletedA.error);
  assert.equal(deletedA.data.id, proofAId);
  const afterDelete = await ownerA.client
    .from("proof_items")
    .select("id")
    .eq("id", proofAId);
  assert.ifError(afterDelete.error);
  assert.deepEqual(afterDelete.data, []);

  const removedImage = await ownerA.client.storage
    .from("proof-images")
    .remove([privatePath]);
  assert.ifError(removedImage.error);
  privatePaths.splice(privatePaths.indexOf(privatePath), 1);

  console.log(
    "Proof Gallery integration passed: CRUD, filters, owner RLS, private images, scoped lexical/semantic retrieval, and Edge Functions.",
  );
} finally {
  if (privatePaths.length > 0) {
    await admin.storage.from("proof-images").remove(privatePaths);
  }
  if (createdUsers.length > 0) {
    await admin.from("proof_items").delete().in("user_id", createdUsers);
    for (const userId of createdUsers) {
      await admin.auth.admin.deleteUser(userId);
    }
  }
}
