import { Router } from "express";
import { Container } from "../container";
import { authMiddleware } from "../middleware/auth";

/**
 * @openapi
 * tags:
 *   - name: Execucoes
 *     description: Fila da oficina e acompanhamento dos reparos
 */
export default function criarExecucaoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /execucoes/fila:
   *   get:
   *     summary: Fila atual da oficina
   *     description: |
   *       Execucoes aguardando atendimento, na ordem em que entraram, com o
   *       tempo total estimado. E a tela de trabalho do mecanico.
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Fila da oficina }
   */
  router.get("/fila", authMiddleware, async (_req, res, next) => {
    try {
      res.json(await container.operarExecucao.fila());
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /execucoes:
   *   get:
   *     summary: Lista execucoes
   *     description: |
   *       Execucoes NAO sao criadas por HTTP: elas nascem do comando
   *       ENFILEIRAR_EXECUCAO enviado pelo orquestrador da Saga. As rotas REST
   *       deste servico apenas consultam e operam o que ja esta na fila.
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [NA_FILA, EM_ANDAMENTO, FINALIZADA, CANCELADA]
   *     responses:
   *       200: { description: Lista de execucoes }
   */
  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.operarExecucao.listar(
          req.query.status as string | undefined,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /execucoes/ordem-servico/{ordemServicoId}:
   *   get:
   *     summary: Consulta a execucao de uma ordem de servico
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: ordemServicoId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Execucao encontrada }
   *       404: { description: Nao existe execucao para esta ordem de servico }
   */
  router.get(
    "/ordem-servico/:ordemServicoId",
    authMiddleware,
    async (req, res, next) => {
      try {
        res.json(
          await container.operarExecucao.porOrdemServico(
            String(req.params.ordemServicoId),
          ),
        );
      } catch (erro) {
        next(erro);
      }
    },
  );

  /**
   * @openapi
   * /execucoes/{id}:
   *   get:
   *     summary: Consulta uma execucao
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Execucao encontrada }
   *       404: { description: Execucao nao encontrada }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.operarExecucao.obter(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /execucoes/{id}/inicio:
   *   post:
   *     summary: Mecanico inicia o reparo
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               mecanico: { type: string, example: "Joao da Silva" }
   *     responses:
   *       200: { description: Execucao iniciada }
   *       409: { description: Transicao de status invalida }
   */
  router.post("/:id/inicio", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.operarExecucao.iniciar(
          String(req.params.id),
          req.body?.mecanico,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /execucoes/{id}/finalizacao:
   *   post:
   *     summary: Mecanico conclui o reparo
   *     description: |
   *       Publica o evento EXECUCAO_FINALIZADA. O OS Service reage a esse fato
   *       e move a ordem de servico para FINALIZADA - sem que este servico
   *       conheca o outro (trecho coreografado do fluxo).
   *     tags: [Execucoes]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               observacoes: { type: string }
   *     responses:
   *       200: { description: Execucao finalizada }
   *       409: { description: Transicao de status invalida }
   */
  router.post("/:id/finalizacao", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.operarExecucao.finalizar(
          String(req.params.id),
          req.body?.observacoes,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}
