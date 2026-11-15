import MensagemProcessadaRepository from "../../domain/repository/MensagemProcessadaRepository";
import CancelarExecucaoUseCase from "../../domain/usecase/Execucao/CancelarExecucaoUseCase";
import EnfileirarExecucaoUseCase from "../../domain/usecase/Execucao/EnfileirarExecucaoUseCase";
import logger from "../logger";
import MessageConsumer, { Manipulador } from "./MessageConsumer";
import {
  BodyCancelarExecucao,
  BodyEnfileirarExecucao,
  FILAS,
  Mensagem,
  TipoComando,
} from "./contracts";

export type CasosDeUsoExecucao = {
  enfileirarExecucao: EnfileirarExecucaoUseCase;
  cancelarExecucao: CancelarExecucaoUseCase;
};

// Adaptador de entrada assincrono: fila saga.execucao.comandos.
//
// Este participante trata apenas um par de comandos:
//   ENFILEIRAR_EXECUCAO <-> CANCELAR_EXECUCAO (compensacao)
export default class ComandoConsumer {
  constructor(
    private readonly casos: CasosDeUsoExecucao,
    private readonly mensagensProcessadas: MensagemProcessadaRepository,
    private readonly consumer: MessageConsumer = new MessageConsumer(),
  ) {}

  async iniciar(): Promise<void> {
    await this.consumer.consumir(FILAS.EXECUCAO_COMANDOS, this.manipuladores());
  }

  manipuladores(): Record<string, Manipulador> {
    return {
      [TipoComando.ENFILEIRAR_EXECUCAO]: this.comIdempotencia(
        async (mensagem) => {
          const body = mensagem.body as BodyEnfileirarExecucao;
          await this.casos.enfileirarExecucao.execute({
            sagaId: mensagem.header.sagaId,
            ordemServicoId: mensagem.header.ordemServicoId,
            clienteId: body.clienteId,
            veiculoId: body.veiculoId,
            itens: body.itens,
            simularFalha: body.simularFalha,
          });
        },
      ),

      [TipoComando.CANCELAR_EXECUCAO]: this.comIdempotencia(async (mensagem) => {
        const body = mensagem.body as BodyCancelarExecucao;
        await this.casos.cancelarExecucao.execute({
          sagaId: mensagem.header.sagaId,
          ordemServicoId: mensagem.header.ordemServicoId,
          motivo: body.motivo,
        });
      }),
    };
  }

  // Desduplicacao duravel (indice unico no MongoDB), nao apenas em memoria:
  // enfileirar duas vezes a mesma OS ocuparia duas vagas da oficina.
  private comIdempotencia(manipulador: Manipulador): Manipulador {
    return async (mensagem: Mensagem) => {
      const { mensagemId, tipo, sagaId } = mensagem.header;

      if (await this.mensagensProcessadas.jaProcessada(mensagemId)) {
        logger.warn(
          { mensagemId, tipo },
          "comando duplicado ignorado (idempotencia duravel)",
        );
        return;
      }

      await manipulador(mensagem);

      await this.mensagensProcessadas.registrar({
        mensagemId,
        tipo: String(tipo),
        sagaId,
      });
    };
  }
}
