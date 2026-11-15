import TelemetriaGateway, {
  ResultadoComando,
} from "../../domain/gateway/TelemetriaGateway";
import { getContexto, getCorrelationId } from "../context";
import logger from "../logger";

type AgenteNewRelic = {
  recordCustomEvent: (nome: string, atributos: Record<string, unknown>) => void;
};

function carregarAgente(): AgenteNewRelic | null {
  if (!process.env.NEW_RELIC_LICENSE_KEY) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("newrelic") as AgenteNewRelic;
  } catch (erro) {
    logger.warn(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "agente New Relic indisponivel; telemetria apenas em log",
    );
    return null;
  }
}

// Observabilidade do servico de Execucao.
//
// O evento ExecucaoFinalizada compara o tempo ESTIMADO com o tempo REAL de
// oficina: e a metrica que a gestao usa para calibrar prazos prometidos ao
// cliente, e o equivalente, neste contexto, ao "tempo medio por status" do
// servico de OS.
export default class NewRelicTelemetriaGateway implements TelemetriaGateway {
  private readonly agente: AgenteNewRelic | null;
  private readonly env: string;
  private readonly servico: string;

  constructor(agente: AgenteNewRelic | null = carregarAgente()) {
    this.agente = agente;
    this.env = process.env.APP_ENV || process.env.NODE_ENV || "local";
    this.servico = process.env.SERVICE_NAME || "fiap-tc-ms-execucao";
  }

  registrarComando(dados: {
    sagaId: string;
    ordemServicoId: string;
    comando: string;
    resultado: ResultadoComando;
    duracaoMs: number;
    erro?: string;
  }): void {
    this.publicar("SagaComandoRecebido", {
      ...dados,
      erro: dados.erro ?? "",
    });
  }

  registrarEnfileiramento(dados: {
    sagaId: string;
    ordemServicoId: string;
    execucaoId: string;
    posicaoFila: number;
    tempoEstimadoMinutos: number;
  }): void {
    this.publicar("ExecucaoEnfileirada", { ...dados });
  }

  registrarFinalizacao(dados: {
    ordemServicoId: string;
    execucaoId: string;
    duracaoMs: number | null;
    tempoEstimadoMinutos: number;
  }): void {
    this.publicar("ExecucaoFinalizada", {
      ...dados,
      duracaoMs: dados.duracaoMs ?? 0,
      // Desvio entre o prometido e o realizado, em minutos.
      desvioMinutos:
        dados.duracaoMs === null
          ? 0
          : Math.round(dados.duracaoMs / 60000) - dados.tempoEstimadoMinutos,
    });
  }

  registrarCancelamento(dados: {
    sagaId: string;
    ordemServicoId: string;
    execucaoId: string;
    motivo: string;
    compensado: boolean;
  }): void {
    // compensado=false significa que o reparo ja estava concluido e NAO pode
    // ser desfeito: pendencia que exige tratamento manual, e por isso tem
    // alerta proprio.
    this.publicar("ExecucaoCancelada", { ...dados });
  }

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void {
    this.publicar("IntegracaoFalha", { ...dados });
  }

  private publicar(evento: string, atributos: Record<string, unknown>) {
    const contexto = getContexto();

    const payload = {
      ...atributos,
      servico: this.servico,
      env: this.env,
      correlationId: getCorrelationId() ?? "",
      sagaIdContexto: contexto?.sagaId ?? "",
    };

    logger.info({ evento, ...payload }, "evento de telemetria");
    this.agente?.recordCustomEvent(evento, payload);
  }
}
