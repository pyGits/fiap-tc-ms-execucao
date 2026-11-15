import MessageConsumer from "../../src/messaging/MessageConsumer";
import MessagePublisher from "../../src/messaging/MessagePublisher";
import {
  EXCHANGE,
  FILAS,
  Mensagem,
  ROUTING_KEYS,
  TipoComando,
} from "../../src/messaging/contracts";
import { getCorrelationId, runComContexto } from "../../src/context";

type Publicacao = {
  routingKey: string;
  conteudo: Record<string, unknown>;
};

class CanalFake {
  readonly publicadas: Publicacao[] = [];
  readonly confirmadas: unknown[] = [];
  readonly rejeitadas: Array<{ requeue: boolean }> = [];
  manipulador?: (raw: unknown) => Promise<void>;

  publish(_exchange: string, routingKey: string, conteudo: Buffer) {
    this.publicadas.push({
      routingKey,
      conteudo: JSON.parse(conteudo.toString()),
    });
    return true;
  }

  async consume(_fila: string, manipulador: (raw: unknown) => Promise<void>) {
    this.manipulador = manipulador;
    return { consumerTag: "tag" };
  }

  ack(mensagem: unknown) {
    this.confirmadas.push(mensagem);
  }

  nack(_mensagem: unknown, _todas: boolean, requeue: boolean) {
    this.rejeitadas.push({ requeue });
  }
}

class ConexaoFake {
  constructor(readonly canal = new CanalFake()) {}
  async getChannel() {
    return this.canal as never;
  }
  async close() {}
}

function comando(
  mensagemId = "msg-1",
  tentativa = 1,
  tipo: TipoComando = TipoComando.ENFILEIRAR_EXECUCAO,
): Mensagem {
  return {
    header: {
      mensagemId,
      sagaId: "saga-1",
      correlationId: "corr-1",
      ordemServicoId: "os-1",
      tipo,
      origem: "fiap-tc-ms-os",
      dataEnvio: new Date().toISOString(),
      tentativa,
    },
    body: {},
  };
}

function envelope(mensagem: Mensagem) {
  return {
    content: Buffer.from(JSON.stringify(mensagem)),
    fields: { routingKey: ROUTING_KEYS.EXECUCAO_COMANDOS, deliveryTag: 1 },
    properties: {},
  };
}

describe("MessagePublisher", () => {
  it("usa o correlationId do contexto no header da mensagem", async () => {
    const conexao = new ConexaoFake();
    const publisher = new MessagePublisher(conexao as never, "execucao");

    await runComContexto({ correlationId: "corr-ctx", sagaId: "saga-1" }, () =>
      publisher.publicar({
        routingKey: ROUTING_KEYS.SAGA_REPLY,
        tipo: TipoComando.ENFILEIRAR_EXECUCAO,
        sagaId: "saga-1",
        ordemServicoId: "os-1",
        body: {},
      }),
    );

    const header = (
      conexao.canal.publicadas[0].conteudo as {
        header: Record<string, unknown>;
      }
    ).header;

    expect(header.correlationId).toBe("corr-ctx");
    expect(header.origem).toBe("execucao");
  });
});

describe("MessageConsumer", () => {
  it("restaura o contexto da mensagem e confirma o processamento", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    let correlationVisto: string | null = null;
    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {
      [TipoComando.ENFILEIRAR_EXECUCAO]: async () => {
        correlationVisto = getCorrelationId();
      },
    });

    await conexao.canal.manipulador!(envelope(comando()));

    expect(correlationVisto).toBe("corr-1");
    expect(conexao.canal.confirmadas).toHaveLength(1);
  });

  it("descarta duplicata pelo mensagemId", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    let execucoes = 0;
    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {
      [TipoComando.ENFILEIRAR_EXECUCAO]: async () => {
        execucoes += 1;
      },
    });

    const mensagem = envelope(comando("msg-dup"));
    await conexao.canal.manipulador!(mensagem);
    await conexao.canal.manipulador!(mensagem);

    expect(execucoes).toBe(1);
    expect(consumer.jaProcessada("msg-dup")).toBe(true);
  });

  it("rejeita payload invalido sem reenfileirar", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {});
    await conexao.canal.manipulador!({
      content: Buffer.from("{invalido"),
      fields: { routingKey: ROUTING_KEYS.EXECUCAO_COMANDOS },
    });

    expect(conexao.canal.rejeitadas).toEqual([{ requeue: false }]);
  });

  it("confirma comando sem manipulador em vez de travar a fila", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {});
    await conexao.canal.manipulador!(
      envelope(comando("msg-1", 1, TipoComando.GERAR_ORCAMENTO)),
    );

    expect(conexao.canal.confirmadas).toHaveLength(1);
  });

  it("reenfileira incrementando a tentativa", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never, 3);

    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {
      [TipoComando.ENFILEIRAR_EXECUCAO]: async () => {
        throw new Error("falha transitoria");
      },
    });

    await conexao.canal.manipulador!(envelope(comando("msg-1", 1)));

    const header = (
      conexao.canal.publicadas[0].conteudo as {
        header: { tentativa: number };
      }
    ).header;

    expect(header.tentativa).toBe(2);
  });

  it("desvia para a dead letter ao esgotar as tentativas", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never, 2);

    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {
      [TipoComando.ENFILEIRAR_EXECUCAO]: async () => {
        throw new Error("falha permanente");
      },
    });

    await conexao.canal.manipulador!(envelope(comando("msg-1", 2)));

    expect(conexao.canal.publicadas[0].routingKey).toBe(
      ROUTING_KEYS.DEAD_LETTER,
    );
    expect(EXCHANGE).toBe("oficina.saga");
  });

  it("ignora entrega nula", async () => {
    const conexao = new ConexaoFake();
    const consumer = new MessageConsumer(conexao as never);

    await consumer.consumir(FILAS.EXECUCAO_COMANDOS, {});
    await conexao.canal.manipulador!(null);

    expect(conexao.canal.confirmadas).toHaveLength(0);
  });
});
