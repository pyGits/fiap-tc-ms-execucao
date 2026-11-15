import { Collection } from "mongodb";

type Documento = Record<string, unknown> & { _id: string };

// Colecao MongoDB em memoria.
//
// Implementa apenas o subconjunto da API que os adaptadores usam - findOne com
// sort, find().sort().limit().toArray(), insertOne, updateOne com upsert e
// countDocuments com $in - o suficiente para testar o MAPEAMENTO entre
// documento e agregado, que e onde mora a logica do adaptador.
//
// A alternativa (mongodb-memory-server) baixa um binario de ~100 MB a cada
// pipeline; o ganho nao compensa para validar serializacao de documentos.
export default class ColecaoFake<T extends Documento> {
  readonly documentos = new Map<string, T>();

  // Erro de chave duplicada, como o driver real lanca.
  private duplicado(): Error {
    const erro = new Error("E11000 duplicate key error") as Error & {
      code: number;
    };
    erro.code = 11000;
    erro.name = "MongoServerError";
    return erro;
  }

  private corresponde(documento: T, filtro: Record<string, unknown>): boolean {
    return Object.entries(filtro).every(([campo, valor]) => {
      const atual = (documento as Record<string, unknown>)[campo];

      if (valor && typeof valor === "object" && "$in" in valor) {
        return (valor as { $in: unknown[] }).$in.includes(atual);
      }
      return atual === valor;
    });
  }

  private ordenar(lista: T[], sort?: Record<string, 1 | -1>): T[] {
    if (!sort) return lista;

    const campos = Object.entries(sort);
    return [...lista].sort((a, b) => {
      for (const [campo, direcao] of campos) {
        const valorA = (a as Record<string, unknown>)[campo];
        const valorB = (b as Record<string, unknown>)[campo];
        const esquerda = valorA instanceof Date ? valorA.getTime() : valorA;
        const direita = valorB instanceof Date ? valorB.getTime() : valorB;

        if (esquerda === direita) continue;
        if (esquerda === undefined || esquerda === null) return 1;
        if (direita === undefined || direita === null) return -1;
        return ((esquerda as number) > (direita as number) ? 1 : -1) * direcao;
      }
      return 0;
    });
  }

  async insertOne(documento: T) {
    if (this.documentos.has(documento._id)) throw this.duplicado();

    this.documentos.set(documento._id, { ...documento });
    return { acknowledged: true, insertedId: documento._id };
  }

  async updateOne(
    filtro: Record<string, unknown>,
    atualizacao: { $set: Partial<T> },
    opcoes?: { upsert?: boolean },
  ) {
    const existente = [...this.documentos.values()].find((documento) =>
      this.corresponde(documento, filtro),
    );

    if (existente) {
      this.documentos.set(existente._id, {
        ...existente,
        ...atualizacao.$set,
      } as T);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    if (opcoes?.upsert) {
      const id = String(filtro._id ?? "");
      this.documentos.set(id, { _id: id, ...atualizacao.$set } as T);
      return { acknowledged: true, matchedCount: 0, upsertedId: id };
    }

    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  }

  async findOne(
    filtro: Record<string, unknown>,
    opcoes?: { sort?: Record<string, 1 | -1> },
  ): Promise<T | null> {
    const encontrados = this.ordenar(
      [...this.documentos.values()].filter((documento) =>
        this.corresponde(documento, filtro),
      ),
      opcoes?.sort,
    );

    return encontrados[0] ?? null;
  }

  find(filtro: Record<string, unknown> = {}) {
    let resultado = [...this.documentos.values()].filter((documento) =>
      this.corresponde(documento, filtro),
    );

    const cursor = {
      sort: (sort: Record<string, 1 | -1>) => {
        resultado = this.ordenar(resultado, sort);
        return cursor;
      },
      limit: (quantidade: number) => {
        resultado = resultado.slice(0, quantidade);
        return cursor;
      },
      toArray: async () => resultado.map((documento) => ({ ...documento })),
    };

    return cursor;
  }

  async countDocuments(filtro: Record<string, unknown> = {}) {
    return [...this.documentos.values()].filter((documento) =>
      this.corresponde(documento, filtro),
    ).length;
  }

  async createIndexes() {
    return [] as string[];
  }

  limpar() {
    this.documentos.clear();
  }

  // Os adaptadores recebem a interface Collection do driver; o dublê cobre
  // apenas os metodos usados, por isso a conversao explicita.
  comoColecao(): Collection<T> {
    return this as unknown as Collection<T>;
  }
}
