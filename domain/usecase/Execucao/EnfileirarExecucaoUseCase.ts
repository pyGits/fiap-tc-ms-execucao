import ErroDominio from "../../ErroDominio";
import Execucao from "../../entity/Execucao";
import ServicoExecutavel from "../../entity/ServicoExecutavel";
import MensageriaGateway from "../../gateway/MensageriaGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import ExecucaoRepository from "../../repository/ExecucaoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";

export type InputEnfileirarExecucao = {
  sagaId: string;
  ordemServicoId: string;
  clienteId: string;
  veiculoId: string;
  itens: Array<{
    id: string;
    descricao: string;
    quantidade: number;
    tipo: string;
  }>;
  // Forca uma falha controlada para demonstrar o rollback no video.
  simularFalha?: boolean;
};

// Capacidade da oficina: fila cheia e uma recusa LEGITIMA de negocio, nao um
// erro tecnico. Ela existe para que a Saga tenha um caminho de falha realista
// no ultimo passo - o que torna a demonstracao do rollback honesta.
const CAPACIDADE_FILA = Number(process.env.CAPACIDADE_FILA || 20);

// Passo 5 da Saga (ultimo): a oficina aceita o servico e o coloca na fila.
export default class EnfileirarExecucaoUseCase {
  constructor(
    private readonly execucaoRepository: ExecucaoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputEnfileirarExecucao): Promise<Execucao | null> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    try {
      // Idempotencia: a mesma Saga nunca entra duas vezes na fila.
      const existente = await this.execucaoRepository.obterPorSaga(input.sagaId);
      if (existente && !existente.estaCancelada()) {
        await this.mensageria.responder(ctx, TipoResposta.EXECUCAO_ENFILEIRADA, {
          execucaoId: existente.id.getValue(),
          posicaoFila: existente.posicaoFila,
        });
        return existente;
      }

      if (input.simularFalha) {
        throw new ErroDominio(
          "execucao.falha.simulada",
          "Falha simulada na execucao para demonstracao do rollback da Saga.",
          409,
        );
      }

      const naFila = await this.execucaoRepository.contarNaFila();
      if (naFila >= CAPACIDADE_FILA) {
        throw new ErroDominio(
          "execucao.fila.cheia",
          `Fila da oficina cheia (${naFila}/${CAPACIDADE_FILA}). Tente novamente mais tarde.`,
          409,
        );
      }

      const servicos = input.itens.map(
        (item) =>
          new ServicoExecutavel({
            referenciaId: item.id,
            descricao: item.descricao,
            tipo: item.tipo,
            quantidade: item.quantidade,
          }),
      );

      const execucao = new Execucao({
        ordemServicoId: input.ordemServicoId,
        clienteId: input.clienteId,
        veiculoId: input.veiculoId,
        sagaId: input.sagaId,
        servicos,
        posicaoFila: naFila + 1,
      });

      await this.execucaoRepository.salvar(execucao);

      this.telemetria.registrarEnfileiramento({
        ...ctx,
        execucaoId: execucao.id.getValue(),
        posicaoFila: execucao.posicaoFila,
        tempoEstimadoMinutos: execucao.tempoEstimadoMinutos(),
      });

      this.telemetria.registrarComando({
        ...ctx,
        comando: "ENFILEIRAR_EXECUCAO",
        resultado: "CONCLUIDO",
        duracaoMs: Date.now() - inicio,
      });

      await this.mensageria.responder(ctx, TipoResposta.EXECUCAO_ENFILEIRADA, {
        execucaoId: execucao.id.getValue(),
        posicaoFila: execucao.posicaoFila,
      });

      return execucao;
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);

      this.telemetria.registrarComando({
        ...ctx,
        comando: "ENFILEIRAR_EXECUCAO",
        resultado: "FALHOU",
        duracaoMs: Date.now() - inicio,
        erro: motivo,
      });

      // Falha no ULTIMO passo e o cenario mais instrutivo da Saga: o
      // orquestrador tera de estornar o pagamento e cancelar o orcamento, em
      // ordem inversa, para devolver o sistema a um estado consistente.
      await this.mensageria.responder(ctx, TipoResposta.EXECUCAO_FALHOU, {
        motivo,
        codigo: erro instanceof ErroDominio ? erro.codigo : "execucao.erro",
      });

      return null;
    }
  }
}
