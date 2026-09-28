# FITAI

Aplicativo web mobile-first que analisa agachamentos localmente pela câmera do dispositivo, conta ciclos completos e mostra feedback experimental de execução.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/fitai/src/pages/home.tsx` — tela inicial e posicionamento do MVP
- `artifacts/fitai/src/pages/analyze.tsx` — câmera, MediaPipe Pose Landmarker e máquina de estados
- `artifacts/fitai/src/pages/report.tsx` — relatório da sessão salvo localmente
- `artifacts/fitai/src/lib/fitai-analysis.ts` — geometria, suavização, estados e métricas experimentais
- `artifacts/fitai/src/index.css` — tema visual e responsividade

## Architecture decisions

- A análise do primeiro MVP acontece no navegador para que o vídeo não seja enviado a servidores.
- O ciclo válido exige a sequência EM_PÉ → DESCENDO → EMBAIXO → SUBINDO → EM_PÉ.
- O índice é experimental e combina profundidade aproximada e duração do ciclo; não representa diagnóstico ou avaliação clínica.
- O primeiro MVP usa localStorage apenas para preservar o último relatório; persistência em banco fica para depois dos testes do contador.

## Product

- Tela inicial com orientação para o MVP do agachamento.
- Câmera traseira, landmarks desenhados no vídeo e status de enquadramento.
- Contagem de repetições completas com filtro de ruído e estados de movimento.
- Métricas por repetição, índice médio e relatório local.
- Tratamento explícito para câmera bloqueada, corpo ausente, enquadramento incompleto e mais de uma pessoa.

## User preferences

- Priorizar funcionalidades reais e processamento local; não mascarar recursos ainda não implementados como se fossem IA.
- Parar após o MVP do agachamento para que o usuário teste câmera e contador antes de expandir o produto.

## Gotchas

- MediaPipe carrega WASM e o modelo por URLs públicas no navegador; é necessário internet na primeira carga da análise.
- A câmera exige permissão do navegador e contexto seguro; quando bloqueada, a sessão não gera pontuação.
- O build manual precisa de `PORT` e `BASE_PATH`; o workflow fornece essas variáveis automaticamente.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
