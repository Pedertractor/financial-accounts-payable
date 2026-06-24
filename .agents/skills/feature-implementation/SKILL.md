---
name: feature-implementation
description: >-
  Implements a new feature end-to-end following project architecture (back-end
  layers, front-end api.ts + pages, Bruno, query keys). Use when the user invokes
  /feature-implementation or asks to implement a feature following project
  patterns.
disable-model-invocation: true
---

# Feature Implementation

Use when invoked with `/feature-implementation` or when explicitly asked to implement a feature following project standards.

## Before coding

1. If not already on a task branch, invoke or follow `.agents/skills/git-branch-workflow/SKILL.md`.
2. Read `.cursor/rules/architecture.mdc`, `api-and-errors.mdc`, and `conventions.mdc`.
3. Clarify escopo mínimo: endpoint(s), tela(s), permissões (role).

## Checklist

Copy and track:

```
- [ ] Branch feature|bugfix|refactor/* (não main/dev)
- [ ] Back-end: rota → controller fino → service → repository
- [ ] Back-end: Zod + HttpError; sem prisma no controller
- [ ] Back-end: Bruno YAML se endpoint novo
- [ ] Front-end: tipos + função em lib/api.ts
- [ ] Front-end: página/modal; RHF + Zod em forms
- [ ] Front-end: query key factory + invalidação correta
- [ ] Sem fetch solto; sem throw new Error() em request (back)
- [ ] /senior-code-review-before-commit antes do commit
```

## Back-end steps

1. **Schema** (se necessário): `prisma/schema.prisma` + migration.
2. **Repository**: métodos em `repositories/prisma/*-repository.ts`.
3. **Service**: regra de negócio, `HttpError`, DTO se expõe dados sensíveis.
4. **Controller**: schema Zod inline ou importado; chama service; retorna `{ entity }`.
5. **Route**: registrar em `http/routes/` com `authMiddleware` / `roleMiddleware` conforme domínio.
6. **Bruno**: `back-end/bruno-api/bruno - financial accounts/<domínio>/<ação>.yml`.

## Front-end steps

1. **API**: tipos + `export async function fooRequest(...)` em `lib/api.ts`.
2. **Schema** (forms): Zod em `lib/` se reutilizado.
3. **UI**: página em `pages/` ou modal em `components/`; extrair se > ~400 linhas.
4. **Data**: `useQuery` / `useMutation` com query key factory; `enabled` para deps.
5. **Rota**: registrar em `App.tsx` dentro de `RequireAuth` + `AppShell` se protegida.
6. **Sidebar**: link em `app-sidebar.tsx` se navegação nova; guard de role se FINANCIAL/ADMIN.

## Done criteria

- Build passa: `npm run build` em `back-end/` e `front-end/`.
- Fluxo manual testável (Bruno + UI).
- Nenhum arquivo novo gigante sem extração.
- Review: `/senior-code-review-before-commit` — corrigir itens críticos antes de commit.

## Out of scope (unless requested)

- OpenAPI / codegen
- DI container
- Migração de pastas `features/`
- Testes automatizados (projeto ainda sem runner — Bruno + manual OK)
