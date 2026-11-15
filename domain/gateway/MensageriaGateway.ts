import { TipoResposta } from "../../src/messaging/contracts";

export type ContextoResposta = {
  sagaId: string;
  ordemServicoId: string;
};

// Porta de saida do participante: responde ao orquestrador e publica o fato
// "execucao finalizada", que ocorre FORA da Saga (ela ja terminou quando a
// execucao foi enfileirada).
export default interface MensageriaGateway {
  responder(
    ctx: ContextoResposta,
    tipo: TipoResposta,
    body: Record<string, unknown>,
  ): Promise<void>;
}
