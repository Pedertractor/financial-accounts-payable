# Tela "Importar Dados" — Painel da Conciliação

Este documento explica o bloco que aparece no topo da tela **Importar Dados**, logo
abaixo do seletor de empresa:

```
Importação                                        [ Aberta ]
Empresa Tractor
Conciliação ativa. Tudo que você importar fica
guardado aqui. Para começar outro período, use
"Nova conciliação" — a atual será encerrada e arquivada.

                                        [ Nova conciliação ]
```

> Na tela **Importar** aparece **só** o botão "Nova conciliação". O botão
> "Encerrar conciliação" fica na tela de **Vínculos/Conciliação**.

> Componente correspondente no código: `front-end/src/components/reconciliation-run-controls.tsx`
> (renderizado por `front-end/src/pages/ImportDataPage.tsx`).

---

## O que é uma "conciliação" (ciclo)

Uma **conciliação** (no back-end chamada de *reconciliation run*) é o **ciclo** que
agrupa tudo que você importa e tria para uma empresa em um determinado período.

Enquanto o ciclo está **aberto**, tudo que você envia — a planilha do banco e/ou o
extrato do sistema interno (Epron), incluindo **reimportações** do mesmo arquivo —
fica dentro **desta mesma conciliação**. Isso mantém os dados e as sugestões de
vínculo organizados por período, sem misturar com ciclos anteriores.

Cada empresa (**Pedertractor** / **Tractor**) tem sua própria conciliação ativa.

---

## Os elementos do painel

### 1. Título da conciliação (`Importação`)

É o nome do ciclo atual. Quando o sistema cria automaticamente uma conciliação (por
não existir nenhuma aberta para a empresa), ele usa o título padrão **"Importação"**.
Ao criar manualmente pelo botão **Nova conciliação**, o título padrão sugerido é
`Conciliação <mês> de <ano>` (ex.: `Conciliação julho de 2026`), mas pode ser editado.

Se o ciclo tiver período de referência definido, ele aparece antes da empresa
(ex.: `01/07/2026 – 31/07/2026 · Empresa Tractor`).

### 2. Selo de status (`Aberta` / `Encerrada`)

| Selo | Significado |
|------|-------------|
| **Aberta** (verde) | O ciclo está ativo. É possível importar/reimportar planilhas e gerar vínculos. |
| **Encerrada** (cinza) | O ciclo foi fechado. **Não é possível importar** novas planilhas neste ciclo. |

Quando a conciliação está encerrada, no lugar do texto explicativo aparece o aviso:

> *Conciliação encerrada — não é possível importar planilhas neste ciclo. Inicie uma
> nova conciliação para o próximo período.*

### 3. Empresa (`Empresa Tractor`)

Indica a empresa (unidade) à qual esta conciliação pertence — **Tractor** ou
**Pedertractor**. Ela é definida pelo seletor de empresa no topo da tela. Trocar a
empresa carrega a conciliação ativa daquela outra unidade.

### 4. Texto explicativo

O texto se adapta ao estado e à tela (`context`):

- **Aberta, com dados (tela Importar):** *"Conciliação ativa. Tudo que você importar
  fica guardado aqui. Para começar outro período, use 'Nova conciliação' — a atual será
  encerrada e arquivada."*
- **Aberta e vazia (tela Importar):** *"Conciliação ativa e ainda vazia. Importe as
  planilhas abaixo..."*
- **Aberta (tela Vínculos):** menciona também o botão *"Encerrar conciliação"*.
- **Encerrada:** aviso de que não é possível importar neste ciclo.

> Uma conciliação é considerada **vazia** quando não há nenhum lançamento (banco **e**
> interno = 0). Essa contagem vem do endpoint `close-preview` (por `runId`).

---

## Os botões

> **Importante:** os botões visíveis dependem da tela (`context`):
> - **Tela Importar** (`context === 'import'`): apenas **Nova conciliação**.
> - **Tela Vínculos/Conciliação** (`context === 'vinculos'`): **Nova conciliação**,
>   **Encerrar conciliação** e, para ADMIN em ciclo encerrado, **Reabrir**.

### Nova conciliação

Abre um diálogo para **criar um ciclo novo e vazio** para a empresa selecionada.

- Você informa (ou aceita) um **título**.
- **Na tela Importar**, criar um novo ciclo **encerra e arquiva automaticamente** a
  conciliação atual (se estiver aberta) — evita deixar duas conciliações abertas da
  mesma empresa. O diálogo mostra as contagens que serão arquivadas e o botão fica
  rotulado **"Encerrar e criar"**.
- **Na tela Vínculos**, apenas cria o novo ciclo; a anterior permanece como está.
- Em ambos os casos, os dados do ciclo anterior **não são apagados** — ficam no
  histórico, disponíveis para consulta em Conciliação.

Use quando começar um **novo período** (ex.: novo mês).

### Encerrar conciliação *(somente na tela Vínculos)*

Aparece apenas quando o ciclo está **aberto** e no contexto de **Vínculos**. Abre um
diálogo de confirmação que:

- Mostra um **resumo** do ciclo antes de fechar:
  - quantidade de **sugestões em aberto** na triagem;
  - quantidade de **lançamentos do banco** e do **interno**;
  - **avisos** (ex.: "há lançamentos só do banco; o interno ainda não foi importado").
- Ao confirmar, marca o ciclo como **Encerrada**.

Quando a conciliação está **vazia**, o botão fica **desabilitado** (com dica: *"Importe
ao menos uma planilha para poder encerrar esta conciliação."*).

O que acontece ao encerrar:

- Os **dados e a triagem continuam disponíveis** para consulta.
- **Novos uploads/importações neste ciclo ficam bloqueados.**

### Reabrir *(condicional)*

Só é exibida quando **todas** as condições abaixo são verdadeiras:

- o ciclo está **Encerrada**;
- o usuário é **ADMIN**;
- o contexto é a tela de **Vínculos/Conciliação** (`context === 'vinculos'`), não a de importação.

Ao reabrir, o ciclo volta ao status **Aberta**.

---

## Fluxo típico de uso

1. Escolha a **empresa** (Tractor ou Pedertractor).
2. O sistema abre (ou cria) a conciliação **Aberta** daquela empresa.
3. Envie/confirme as planilhas do **banco** e/ou do **interno** — tudo fica neste ciclo.
4. Gere os **vínculos** e faça a triagem em **Conciliação**.
5. Ao terminar o período, encerre em **Conciliação** via **Encerrar conciliação** (revise o resumo e confirme) — opcional.
6. Para o próximo período, na tela **Importar**, clique em **Nova conciliação** (isso já
   encerra e arquiva a atual e começa um ciclo vazio).

---

## Referências no código

| Item | Local |
|------|-------|
| Painel (UI) | `front-end/src/components/reconciliation-run-controls.tsx` |
| Tela que usa o painel | `front-end/src/pages/ImportDataPage.tsx` |
| Resolução/criação do ciclo ativo | `front-end/src/lib/reconcile-run-session.ts` (`resolveImportReconciliationRunId`) |
| Regras de negócio (encerrar/reabrir/preview) | `back-end/src/services/reconciliation-run-service.ts` |
| Bloqueio de import em ciclo encerrado | `RUN_CLOSED_IMPORT_MESSAGE` / `assertRunOpenForImport` (mesmo arquivo) |
