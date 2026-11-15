import MensageriaGateway, {
  ContextoResposta,
} from "../../domain/gateway/MensageriaGateway";
import MessagePublisher from "./MessagePublisher";
import { ROUTING_KEYS, TipoResposta } from "./contracts";

// Adaptador de saida do participante: toda resposta vai para a MESMA fila de
// reply do orquestrador. O Billing nao conhece o servico de Execucao nem
// publica nada diretamente para ele.
export default class RabbitMQMensageriaGateway implements MensageriaGateway {
  constructor(
    private readonly publisher: MessagePublisher = new MessagePublisher(),
  ) {}

  async responder(
    ctx: ContextoResposta,
    tipo: TipoResposta,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.publisher.publicar({
      routingKey: ROUTING_KEYS.SAGA_REPLY,
      tipo,
      sagaId: ctx.sagaId,
      ordemServicoId: ctx.ordemServicoId,
      body,
    });
  }
}
