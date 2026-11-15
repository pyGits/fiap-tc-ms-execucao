import ErroDominio from "../ErroDominio";

// Tempo estimado por tipo de item, em minutos.
//
// Pecas e insumos nao consomem tempo de bancada por si: o tempo esta no
// servico que os aplica. Esta tabela e uma regra de NEGOCIO deste contexto -
// o OS Service nao a conhece.
const TEMPO_PADRAO_MINUTOS: Record<string, number> = {
  SERVICO: 60,
  PECA: 15,
  INSUMO: 5,
};

// Objeto de valor: um servico a ser executado no veiculo.
export default class ServicoExecutavel {
  readonly referenciaId: string;
  readonly descricao: string;
  readonly tipo: string;
  readonly quantidade: number;
  readonly tempoEstimadoMinutos: number;
  concluido: boolean;

  constructor(dados: {
    referenciaId: string;
    descricao: string;
    tipo: string;
    quantidade: number;
    tempoEstimadoMinutos?: number;
    concluido?: boolean;
  }) {
    if (!dados.descricao || dados.descricao.trim().length === 0) {
      throw new ErroDominio(
        "servico.descricao.obrigatoria",
        "Descricao do servico e obrigatoria.",
      );
    }
    if (!Number.isFinite(dados.quantidade) || dados.quantidade <= 0) {
      throw new ErroDominio(
        "servico.quantidade.invalida",
        "Quantidade do servico deve ser maior que zero.",
      );
    }

    const tipo = String(dados.tipo || "SERVICO").toUpperCase();

    this.referenciaId = dados.referenciaId;
    this.descricao = dados.descricao.trim();
    this.tipo = tipo;
    this.quantidade = dados.quantidade;
    this.tempoEstimadoMinutos =
      dados.tempoEstimadoMinutos ??
      (TEMPO_PADRAO_MINUTOS[tipo] ?? 30) * dados.quantidade;
    this.concluido = dados.concluido ?? false;
  }

  concluir() {
    this.concluido = true;
  }
}
