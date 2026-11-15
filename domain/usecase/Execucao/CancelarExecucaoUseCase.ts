import MensageriaGateway from "../../gateway/MensageriaGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import ExecucaoRepository from "../../repository/ExecucaoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";
import logger from "../../../src/logger";

export type InputCancelarExecucao = {
  sagaId: string;
  ordemServicoId: string;
  motivo: string;
};

// TRANSACAO COMPENSATORIA de ENFILEIRAR_EXECUCAO.
//
// Aqui aparece o limite real da compensacao: se o servico ja foi FINALIZADO,
// nao existe transacao que desmonte o reparo. A compensacao registra o
// impedimento (compensado: false) e responde de todo jeito, para que a Saga
// saia de COMPENSANDO e o caso apareca no dashboard como pendencia manual.
//
// E a diferenca entre compensar e fazer rollback: ACD, nao ACID.
export default class CancelarExecucaoUseCase {
  constructor(
    private readonly execucaoRepository: ExecucaoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputCancelarExecucao): Promise<void> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    const execucao = await this.execucaoRepository.obterPorSaga(input.sagaId);

    if (!execucao) {
      logger.warn(
        { sagaId: input.sagaId },
        "compensacao sem execucao correspondente: nada a cancelar",
      );
      await this.mensageria.responder(ctx, TipoResposta.EXECUCAO_CANCELADA, {
        motivo: input.motivo,
        compensado: true,
      });
      return;
    }

    const compensado = execucao.cancelar(input.motivo);

    if (compensado) {
      await this.execucaoRepository.atualizar(execucao);
    } else {
      logger.error(
        {
          execucaoId: execucao.id.getValue(),
          ordemServicoId: execucao.ordemServicoId,
        },
        "execucao ja finalizada: compensacao impossivel, tratamento manual necessario",
      );
    }

    this.telemetria.registrarCancelamento({
      ...ctx,
      execucaoId: execucao.id.getValue(),
      motivo: input.motivo,
      compensado,
    });

    this.telemetria.registrarComando({
      ...ctx,
      comando: "CANCELAR_EXECUCAO",
      resultado: "COMPENSADO",
      duracaoMs: Date.now() - inicio,
    });

    await this.mensageria.responder(ctx, TipoResposta.EXECUCAO_CANCELADA, {
      execucaoId: execucao.id.getValue(),
      motivo: input.motivo,
      compensado,
    });
  }
}
