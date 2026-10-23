# Tests golden et cas de référence

| Dossier            | Contenu                                                                  | Effet sur le build           |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------- |
| `golden/cases/`    | Bulletins réels anonymisés, **validés par écrit** par l'expert-comptable | Bloquant : au franc près     |
| `reference/cases/` | Exemples publics (simulateurs, guides)                                   | Non bloquant : écarts listés |

**Uniquement des données anonymisées.** Aucun nom, n° CNPS, NIU ni IBAN réel.

## Format d'un cas (`<id>.json`)

```json
{
  "id": "pme-commerce-001",
  "description": "Vendeur, CDI, 185 000 FCFA, prime de rendement",
  "provenance": { "by": "Nom de l'expert-comptable", "date": "2026-11-15" },
  "rulesFile": "cm-2026.validated.json",
  "input": {
    "period": { "start": "2026-03-01", "end": "2026-03-31" },
    "employer": { "regime": "general", "workAccidentRate": 175 },
    "employee": { "baseSalary": 185000, "hireDate": "2024-01-15", "endDate": null },
    "items": [
      {
        "code": "prime",
        "label": "Prime de rendement",
        "kind": "earning",
        "amount": 15000,
        "subjectToCnps": true,
        "taxable": true
      }
    ]
  },
  "expected": { "lines": { "irpp": 0, "cnps.pension.employee": 0 }, "netPay": 0, "employerCost": 0 }
}
```

Codes de ligne : `base`, `overtime.<catégorie>`, `item.<code>`, `cnps.pension.employee`,
`cnps.pension.employer`, `cnps.family`, `cnps.work_accident`, `irpp`, `cac`, `cfc.employee`,
`cfc.employer`, `fne`, `rav`, `tdl`.

`pnpm test:golden` rejoue les cas golden.
