import { Collection } from "mongodb";
import MensagemProcessadaRepository from "../MensagemProcessadaRepository";

export type DocumentoMensagem = {
  _id: string;
  mensagemId: string;
  tipo: string;
  sagaId?: string;
  processadaEm: Date;
};

// Desduplicacao DURAVEL das mensagens.
//
// O indice unico em mensagemId faz o trabalho pesado: se duas replicas do pod
// receberem a mesma reentrega ao mesmo tempo, apenas uma consegue inserir - a
// outra recebe erro de chave duplicada e para. Sem isso, a janela de corrida
// permitiria cobrar o cliente duas vezes.
export default class MensagemProcessadaRepositoryMongo
  implements MensagemProcessadaRepository
{
  constructor(private readonly colecao: Collection<DocumentoMensagem>) {}

  async jaProcessada(mensagemId: string): Promise<boolean> {
    const documento = await this.colecao.findOne({ mensagemId });
    return Boolean(documento);
  }

  async registrar(dados: {
    mensagemId: string;
    tipo: string;
    sagaId?: string;
  }): Promise<void> {
    try {
      await this.colecao.insertOne({
        _id: dados.mensagemId,
        mensagemId: dados.mensagemId,
        tipo: dados.tipo,
        sagaId: dados.sagaId,
        processadaEm: new Date(),
      });
    } catch (erro) {
      // Codigo 11000 = chave duplicada. Outra replica registrou primeiro, o que
      // e justamente o resultado desejado.
      //
      // A verificacao e pelo CODIGO e nao por instanceof: o driver embrulha o
      // erro de formas diferentes conforme a operacao (bulk, retryable write),
      // e o codigo e estavel em todas elas.
      if ((erro as { code?: number }).code === 11000) return;
      throw erro;
    }
  }
}
