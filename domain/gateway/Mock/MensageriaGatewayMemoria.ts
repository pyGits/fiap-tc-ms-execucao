import MensageriaGateway, { ContextoResposta } from "../MensageriaGateway";
import { TipoResposta } from "../../../src/messaging/contracts";

export type RespostaEnviada = {
  tipo: TipoResposta;
  ctx: ContextoResposta;
  body: Record<string, unknown>;
};

// Duble da mensageria: guarda as respostas que iriam para a fila de reply.
// Nos testes, a asserçao "o participante respondeu PAGAMENTO_FALHOU" e o que
// prova que o rollback seria disparado.
export default class MensageriaGatewayMemoria implements MensageriaGateway {
  readonly respostas: RespostaEnviada[] = [];

  async responder(
    ctx: ContextoResposta,
    tipo: TipoResposta,
    body: Record<string, unknown>,
  ): Promise<void> {
    this.respostas.push({ tipo, ctx: { ...ctx }, body: { ...body } });
  }

  tipos(): TipoResposta[] {
    return this.respostas.map((resposta) => resposta.tipo);
  }

  ultima(): RespostaEnviada | undefined {
    return this.respostas[this.respostas.length - 1];
  }

  buscar(tipo: TipoResposta): RespostaEnviada | undefined {
    return this.respostas.find((resposta) => resposta.tipo === tipo);
  }

  limpar() {
    this.respostas.length = 0;
  }
}
