import "dotenv/config";
import { Collection, Db, Document, MongoClient } from "mongodb";
import logger from "./logger";

// Banco PROPRIO do servico de Execucao (MongoDB).
//
// Por que documentos aqui? A execucao e um agregado fechado (lista de servicos
// de um veiculo em uma posicao de fila), lido sempre por inteiro, e e o
// contexto cujo esquema mais tende a evoluir: checklists, apontamentos do
// mecanico, fotos do reparo. Um banco de documentos absorve essa evolucao sem
// exigir migration a cada campo novo.
//
// Nenhum outro microsservico tem credencial para este banco. O OS Service
// descobre o andamento da execucao por MENSAGEM, nunca por consulta direta.
const URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const NOME_BANCO = process.env.MONGO_DB || "fiap_tc_execucao";

let cliente: MongoClient | null = null;
let banco: Db | null = null;

export async function conectarMongo(): Promise<Db> {
  if (banco) return banco;

  cliente = new MongoClient(URI, {
    // Timeout curto: um participante que trava esperando o banco deixa o
    // orquestrador sem resposta e a Saga parada.
    serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000),
    retryWrites: true,
  });

  await cliente.connect();
  banco = cliente.db(NOME_BANCO);

  await criarIndices(banco);

  logger.info({ banco: NOME_BANCO }, "conectado ao MongoDB");
  return banco;
}

// Indices criados em codigo: garantem que local, hml e prd subam identicos,
// do mesmo jeito que as migrations fazem no servico de OS.
async function criarIndices(db: Db): Promise<void> {
  await db
    .collection("execucoes")
    .createIndexes([
      { key: { ordemServicoId: 1 }, name: "idx_execucao_os" },
      { key: { sagaId: 1 }, name: "idx_execucao_saga" },
      { key: { veiculoId: 1 }, name: "idx_execucao_veiculo" },
      // Indice composto: a consulta da fila filtra por status e ordena por
      // posicao - e a leitura mais frequente do servico.
      { key: { status: 1, posicaoFila: 1 }, name: "idx_execucao_fila" },
    ]);

  // Chave unica no mensagemId: torna a idempotencia a prova de corrida entre
  // duas replicas do pod.
  await db
    .collection("mensagens_processadas")
    .createIndexes([
      { key: { mensagemId: 1 }, name: "uq_mensagem", unique: true },
      {
        key: { processadaEm: 1 },
        name: "ttl_mensagem",
        expireAfterSeconds: 60 * 60 * 24 * 7,
      },
    ]);
}

export function colecao<T extends Document>(nome: string): Collection<T> {
  if (!banco) {
    throw new Error("MongoDB nao conectado: chame conectarMongo() antes.");
  }
  return banco.collection<T>(nome);
}

export async function fecharMongo(): Promise<void> {
  await cliente?.close();
  cliente = null;
  banco = null;
}

export default conectarMongo;
