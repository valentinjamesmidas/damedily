import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SENSITIVE_KEYS = [
  "internal_project_tag",
  "source_platform",
  "cost_price_czk",
  "supplier_order_ref",
] as const;

const SECRET_MARKER = "SUP-SECRET-RLS-API";
const CUSTOMER_ID = randomUUID();
const OTHER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ITEM_ID = randomUUID();
const ORDER_ID = randomUUID();
const OTHER_ORDER_ID = randomUUID();
const ORDER_ITEM_ID = randomUUID();
const OTHER_ORDER_ITEM_ID = randomUUID();

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface ApiResult {
  status: number;
  body: Json;
  text: string;
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function requiredConfig(): { url: string; anonKey: string; serviceKey: string } {
  const url = firstEnv(["SUPABASE_URL", "API_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const anonKey = firstEnv([
    "SUPABASE_ANON_KEY",
    "ANON_KEY",
    "PUBLISHABLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);
  const serviceKey = firstEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
    "SECRET_KEY",
    "SUPABASE_SECRET_KEY",
  ]);

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Chybí URL nebo klíče lokálního Supabase. Spusťte `supabase start` a načtěte `supabase status -o env`.",
    );
  }

  return { url: url.replace(/\/$/, ""), anonKey, serviceKey };
}

const config = requiredConfig();

function assertNoSensitive(payload: unknown, label: string): void {
  const text = JSON.stringify(payload);
  for (const key of SENSITIVE_KEYS) {
    expect(text, `${label} nesmí obsahovat klíč ${key}`).not.toContain(`"${key}"`);
  }
  expect(text, `${label} nesmí obsahovat referenci dodavatele`).not.toContain(SECRET_MARKER);
  expect(text, `${label} nesmí obsahovat tag ekokladno`).not.toContain("ekokladno");
  expect(text, `${label} nesmí obsahovat zdroj ovoko`).not.toContain("ovoko");
}

async function request(
  path: string,
  init: {
    method?: string;
    key: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<ApiResult> {
  const response = await fetch(`${config.url}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key,
      Authorization: `Bearer ${init.token ?? init.key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: Json = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, text };
}

function errorCode(result: ApiResult): string | undefined {
  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    const code = result.body.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }
  throw new Error(`Čekal jsem číslo, přišlo ${JSON.stringify(value)}`);
}

function moneyRow(row: { [key: string]: Json }, keys: string[]): { [key: string]: Json } {
  const copy: { [key: string]: Json } = { ...row };
  for (const key of keys) {
    if (key in copy) {
      copy[key] = asNumber(copy[key]);
    }
  }
  return copy;
}

function rowsOf(body: Json): { [key: string]: Json }[] {
  if (!Array.isArray(body)) {
    throw new Error(`Čekal jsem pole řádků, přišlo ${JSON.stringify(body)}`);
  }
  return body.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Řádek není objekt: ${JSON.stringify(row)}`);
    }
    return row;
  });
}

function openApiPropertyNames(body: Json): Set<string> {
  const names = new Set<string>();
  const visit = (node: Json): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    const properties = node.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      for (const key of Object.keys(properties)) {
        names.add(key);
      }
    }
    for (const value of Object.values(node)) {
      visit(value);
    }
  };
  visit(body);
  return names;
}

async function createConfirmedUser(id: string, email: string): Promise<void> {
  const result = await request("/auth/v1/admin/users", {
    method: "POST",
    key: config.serviceKey,
    body: {
      id,
      email,
      password: "Test-heslo-krok1",
      email_confirm: true,
    },
  });
  expect([200, 201], result.text).toContain(result.status);
}

async function signIn(email: string): Promise<string> {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    key: config.anonKey,
    token: config.anonKey,
    body: { email, password: "Test-heslo-krok1" },
  });
  expect(result.status, result.text).toBe(200);
  if (!result.body || typeof result.body !== "object" || Array.isArray(result.body)) {
    throw new Error("Přihlášení nevrátilo objekt.");
  }
  const token = result.body.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Přihlášení nevrátilo access_token.");
  }
  return token;
}

async function rest(
  path: string,
  token: string,
  key: string,
  method = "GET",
  body?: unknown,
): Promise<ApiResult> {
  return request(`/rest/v1/${path}`, {
    method,
    key,
    token,
    body,
    headers: { Prefer: "return=representation" },
  });
}

describe("Data API neschovává citlivé sloupce jen na klientovi", () => {
  const customerEmail = `zakaznik-${CUSTOMER_ID}@damedily.test`;
  const otherEmail = `jiny-${OTHER_ID}@damedily.test`;
  const adminEmail = `admin-${ADMIN_ID}@damedily.test`;
  let customerToken = "";
  let otherToken = "";
  let adminToken = "";

  beforeAll(async () => {
    await createConfirmedUser(CUSTOMER_ID, customerEmail);
    await createConfirmedUser(OTHER_ID, otherEmail);
    await createConfirmedUser(ADMIN_ID, adminEmail);

    const profile = await rest(
      `profiles?id=eq.${CUSTOMER_ID}&select=role`,
      config.serviceKey,
      config.serviceKey,
    );
    expect(profile.status, profile.text).toBe(200);
    expect(profile.body).toEqual([{ role: "customer" }]);

    const promote = await rest(
      `profiles?id=eq.${ADMIN_ID}`,
      config.serviceKey,
      config.serviceKey,
      "PATCH",
      { role: "admin" },
    );
    expect(promote.status, promote.text).toBe(200);

    customerToken = await signIn(customerEmail);
    otherToken = await signIn(otherEmail);
    adminToken = await signIn(adminEmail);

    const item = await rest("inventory_items", adminToken, config.anonKey, "POST", {
      id: ITEM_ID,
      title_cs: "Brzdový kotouč API",
      oem_number: `OEM-${ITEM_ID.slice(0, 8)}`,
      part_category: "Brzdy",
      cost_price_czk: 100,
      selling_price_czk: 150,
      stock_quantity: 2,
      placement_type: "action_offer",
      internal_project_tag: "damedily",
    });
    expect([200, 201], item.text).toContain(item.status);

    const order = await rest("orders", config.serviceKey, config.serviceKey, "POST", {
      id: ORDER_ID,
      order_number: `DD-API-${ORDER_ID.slice(0, 8)}`,
      user_id: CUSTOMER_ID,
      total_amount_czk: 2500,
    });
    expect([200, 201], order.text).toContain(order.status);

    const otherOrder = await rest("orders", config.serviceKey, config.serviceKey, "POST", {
      id: OTHER_ORDER_ID,
      order_number: `DD-API-${OTHER_ORDER_ID.slice(0, 8)}`,
      user_id: OTHER_ID,
      total_amount_czk: 2500,
    });
    expect([200, 201], otherOrder.text).toContain(otherOrder.status);

    const orderItem = await rest("order_items", config.serviceKey, config.serviceKey, "POST", {
      id: ORDER_ITEM_ID,
      order_id: ORDER_ID,
      item_title_cs: "Brzdový kotouč API",
      oem_number: "OEM-API",
      source_platform: "ovoko",
      supplier_order_ref: `${SECRET_MARKER}-1`,
      internal_project_tag: "ekokladno",
      cost_price_czk: 80,
      selling_price_czk: 150,
      quantity: 1,
    });
    expect([200, 201], orderItem.text).toContain(orderItem.status);

    const otherItem = await rest("order_items", config.serviceKey, config.serviceKey, "POST", {
      id: OTHER_ORDER_ITEM_ID,
      order_id: OTHER_ORDER_ID,
      item_title_cs: "Jiná položka API",
      oem_number: "OEM-OTHER",
      source_platform: "autodoc",
      supplier_order_ref: `${SECRET_MARKER}-2`,
      internal_project_tag: "damedily",
      cost_price_czk: 90,
      selling_price_czk: 140,
      quantity: 1,
    });
    expect([200, 201], otherItem.text).toContain(otherItem.status);
  });

  afterAll(async () => {
    await rest(`order_items?id=in.(${ORDER_ITEM_ID},${OTHER_ORDER_ITEM_ID})`, config.serviceKey, config.serviceKey, "DELETE");
    await rest(`orders?id=in.(${ORDER_ID},${OTHER_ORDER_ID})`, config.serviceKey, config.serviceKey, "DELETE");
    await rest(`inventory_items?id=eq.${ITEM_ID}`, config.serviceKey, config.serviceKey, "DELETE");
    await request(`/auth/v1/admin/users/${CUSTOMER_ID}`, { method: "DELETE", key: config.serviceKey });
    await request(`/auth/v1/admin/users/${OTHER_ID}`, { method: "DELETE", key: config.serviceKey });
    await request(`/auth/v1/admin/users/${ADMIN_ID}`, { method: "DELETE", key: config.serviceKey });
  });

  it("anon nedostane tabulku skladu a veřejné view je bez citlivých polí", async () => {
    const table = await rest("inventory_items?select=*", config.anonKey, config.anonKey);
    expect(table.status).toBeGreaterThanOrEqual(400);
    expect(errorCode(table)).toBe("42501");
    assertNoSensitive(table.body, "anon inventory_items");

    const view = await rest(
      `public_inventory?id=eq.${ITEM_ID}&select=*`,
      config.anonKey,
      config.anonKey,
    );
    expect(view.status).toBe(200);
    const viewRows = rowsOf(view.body).map((row) => moneyRow(row, ["selling_price_czk", "stock_quantity"]));
    expect(viewRows).toEqual([
      expect.objectContaining({
        id: ITEM_ID,
        title_cs: "Brzdový kotouč API",
        selling_price_czk: 150,
      }),
    ]);
    assertNoSensitive(viewRows, "anon public_inventory");

    const spec = await request("/rest/v1/", {
      key: config.anonKey,
      headers: { Accept: "application/openapi+json" },
    });
    expect(spec.status).toBe(200);
    const properties = openApiPropertyNames(spec.body);
    for (const key of SENSITIVE_KEYS) {
      expect(properties, `OpenAPI anona nesmí vystavit sloupec ${key}`).not.toContain(key);
    }
  });

  it("zákazník nevidí skladovou tabulku ani cizí objednávku a view je ořezané", async () => {
    const table = await rest("inventory_items?select=cost_price_czk,internal_project_tag", customerToken, config.anonKey);
    expect(table.status).toBe(200);
    expect(table.body).toEqual([]);

    const probed = await rest("inventory_items?cost_price_czk=eq.100&select=id", customerToken, config.anonKey);
    expect(probed.status).toBe(200);
    expect(probed.body).toEqual([]);

    const view = await rest(`public_inventory?id=eq.${ITEM_ID}&select=*`, customerToken, config.anonKey);
    expect(view.status).toBe(200);
    const viewRows = rowsOf(view.body).map((row) => moneyRow(row, ["selling_price_czk"]));
    expect(viewRows).toEqual([expect.objectContaining({ selling_price_czk: 150 })]);
    assertNoSensitive(viewRows, "customer public_inventory");

    const items = await rest("order_items?select=*", customerToken, config.anonKey);
    expect(items.status).toBe(200);
    expect(items.body).toEqual([]);

    const own = await rest("customer_order_items?select=*", customerToken, config.anonKey);
    expect(own.status).toBe(200);
    const ownRows = rowsOf(own.body).map((row) => moneyRow(row, ["selling_price_czk", "quantity"]));
    expect(ownRows).toEqual([
      {
        id: ORDER_ITEM_ID,
        order_id: ORDER_ID,
        item_title_cs: "Brzdový kotouč API",
        oem_number: "OEM-API",
        selling_price_czk: 150,
        quantity: 1,
      },
    ]);
    assertNoSensitive(ownRows, "customer_order_items");

    const foreignOrder = await rest(`orders?id=eq.${OTHER_ORDER_ID}&select=*`, customerToken, config.anonKey);
    expect(foreignOrder.status).toBe(200);
    expect(foreignOrder.body).toEqual([]);

    const ownOrder = await rest(`orders?id=eq.${ORDER_ID}&select=id,total_amount_czk`, customerToken, config.anonKey);
    expect(ownOrder.status).toBe(200);
    expect(rowsOf(ownOrder.body).map((row) => moneyRow(row, ["total_amount_czk"]))).toEqual([
      { id: ORDER_ID, total_amount_czk: 2500 },
    ]);
  });

  it("CHECK 2 000 Kč platí i přes Data API a zákazník si nezmění roli", async () => {
    const tooSmall = await rest("orders", customerToken, config.anonKey, "POST", {
      order_number: `DD-LOW-${CUSTOMER_ID.slice(0, 8)}`,
      user_id: CUSTOMER_ID,
      total_amount_czk: 1999,
    });
    expect(tooSmall.status).toBeGreaterThanOrEqual(400);
    expect(errorCode(tooSmall)).toBe("23514");

    const exact = await rest("orders", customerToken, config.anonKey, "POST", {
      order_number: `DD-OK-${CUSTOMER_ID.slice(0, 8)}`,
      user_id: CUSTOMER_ID,
      total_amount_czk: 2000,
    });
    expect([200, 201], exact.text).toContain(exact.status);
    const created = Array.isArray(exact.body) ? exact.body[0] : null;
    const createdId =
      created && typeof created === "object" && !Array.isArray(created) && typeof created.id === "string"
        ? created.id
        : null;
    expect(createdId).toEqual(expect.any(String));
    if (createdId) {
      await rest(`orders?id=eq.${createdId}`, config.serviceKey, config.serviceKey, "DELETE");
    }

    const foreign = await rest("orders", customerToken, config.anonKey, "POST", {
      order_number: `DD-CIZI-${CUSTOMER_ID.slice(0, 8)}`,
      user_id: OTHER_ID,
      total_amount_czk: 2500,
    });
    expect(foreign.status).toBeGreaterThanOrEqual(400);

    const escalate = await rest(`profiles?id=eq.${CUSTOMER_ID}`, customerToken, config.anonKey, "PATCH", {
      role: "admin",
    });
    expect(escalate.status).toBeGreaterThanOrEqual(400);
    expect(errorCode(escalate)).toBe("42501");

    const profile = await rest(`profiles?id=eq.${CUSTOMER_ID}&select=role`, customerToken, config.anonKey);
    expect(profile.body).toEqual([{ role: "customer" }]);
  });

  it("druhý zákazník nevidí cizí položku a admin vidí nákup i zdroj", async () => {
    const hidden = await rest("customer_order_items?select=*", otherToken, config.anonKey);
    expect(hidden.status).toBe(200);
    const rows = Array.isArray(hidden.body) ? hidden.body : [];
    expect(rows.some((row) => row && typeof row === "object" && !Array.isArray(row) && row.id === ORDER_ITEM_ID)).toBe(false);
    assertNoSensitive(hidden.body, "cizí zákazník");

    const inventory = await rest(
      `inventory_items?id=eq.${ITEM_ID}&select=cost_price_czk,internal_project_tag`,
      adminToken,
      config.anonKey,
    );
    expect(inventory.status).toBe(200);
    expect(rowsOf(inventory.body).map((row) => moneyRow(row, ["cost_price_czk"]))).toEqual([
      { cost_price_czk: 100, internal_project_tag: "damedily" },
    ]);

    const secret = await rest(
      `order_items?id=eq.${ORDER_ITEM_ID}&select=source_platform,supplier_order_ref,cost_price_czk,internal_project_tag`,
      adminToken,
      config.anonKey,
    );
    expect(secret.status).toBe(200);
    expect(rowsOf(secret.body).map((row) => moneyRow(row, ["cost_price_czk"]))).toEqual([
      {
        source_platform: "ovoko",
        supplier_order_ref: `${SECRET_MARKER}-1`,
        cost_price_czk: 80,
        internal_project_tag: "ekokladno",
      },
    ]);
  });
});
