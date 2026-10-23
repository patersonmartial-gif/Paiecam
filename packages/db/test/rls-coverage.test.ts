import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./db";

afterAll(async () => {
  await db.$client.end();
});

/**
 * Filet de sécurité : toute table portant un tenant_id (et la table tenants elle-même) doit
 * avoir le RLS activé ET forcé, avec au moins une politique. Une nouvelle table qui l'oublie
 * fait échouer ce test.
 */
/**
 * Exceptions justifiées (voir la migration correspondante) : tables sans aucune donnée de paie
 * ni de personne, relues ensuite sous RLS.
 */
const RLS_EXCEPTIONS = ["declaration_deadlines"];

describe("couverture du RLS", () => {
  it("chaque table d'entreprise a le RLS activé, forcé et des politiques", async () => {
    const rows = await db.execute<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and (c.relname = 'tenants' or exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id'))
      order by c.relname`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows.filter((x) => !RLS_EXCEPTIONS.includes(x.table))) {
      expect({ table: r.table, rls: r.rls, forced: r.forced }).toEqual({
        table: r.table,
        rls: true,
        forced: true,
      });
      expect(r.policies, `${r.table} sans politique`).toBeGreaterThan(0);
    }
  });

  it("les exceptions ne contiennent que des identifiants, dates et états", async () => {
    const cols = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'declaration_deadlines' order by ordinal_position`);
    expect(cols.map((c) => c.column_name)).toEqual([
      "declaration_id",
      "tenant_id",
      "due_date",
      "status",
    ]);
  });

  it("le rôle applicatif n'a ni UPDATE ni DELETE sur audit_log, ni INSERT direct sur tenants", async () => {
    const [p] = await db.execute<Record<string, boolean>>(sql`
      select has_table_privilege('audit_log', 'UPDATE') as audit_update,
             has_table_privilege('audit_log', 'DELETE') as audit_delete,
             has_table_privilege('audit_log', 'TRUNCATE') as audit_truncate,
             has_table_privilege('tenants', 'INSERT') as tenants_insert,
             has_table_privilege('tenants', 'DELETE') as tenants_delete,
             has_table_privilege('pay_rules', 'UPDATE') as rules_update`);
    expect(p).toEqual({
      audit_update: false,
      audit_delete: false,
      audit_truncate: false,
      tenants_insert: false,
      tenants_delete: false,
      rules_update: false,
    });
  });
});

describe("rôle de supervision", () => {
  it("ne voit aucune donnée d'entreprise et ne peut rien écrire", async () => {
    const { createDb } = await import("../src");
    const { testOpsDatabaseUrl } = await import("../src/testing");
    const ops = createDb(testOpsDatabaseUrl());
    try {
      const [p] = await ops.execute<Record<string, boolean>>(sql`
        select has_table_privilege('tenants', 'SELECT') as tenants,
               has_table_privilege('memberships', 'SELECT') as memberships,
               has_table_privilege('users', 'SELECT') as users,
               has_table_privilege('audit_log', 'INSERT') as audit_insert`);
      expect(p).toEqual({ tenants: false, memberships: false, users: false, audit_insert: false });
      const rows = await ops.execute(sql`select 1 from audit_log where tenant_id is not null`);
      expect(rows).toHaveLength(0);
    } finally {
      await ops.$client.end();
    }
  });
});
