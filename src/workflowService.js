const WorkflowRunner = require('./runner');
const { injectParameters, extractParameterNames } = require('./utils/parameterInjector');

/**
 * WorkflowService
 *
 * Wraps WorkflowRunner with:
 * - Template loading by workflowId
 * - Placeholder extraction
 * - Generic parameter validation and injection
 *
 * This class is intentionally agnostic about how workflows are stored.
 * You can pass a custom loadWorkflowTemplate function that fetches from
 * your main application's database. For now, a simple in-memory
 * registration map is also supported.
 */
class WorkflowService {
  /**
   * @param {Object} options
   * @param {function(string): Promise<Object>|function(string): Object} [options.loadWorkflowTemplate]
   *        Function to load a workflow template by id. If not provided,
   *        the internal in-memory registry will be used.
   * @param {function(string, Object, string[]): Promise<void>|function(string, Object, string[]): void} [options.saveWorkflowTemplate]
   *        Optional function to persist a workflow template and its required parameters.
   * @param {typeof WorkflowRunner} [options.RunnerClass]
   *        Custom runner class, defaults to the local WorkflowRunner.
   */
  constructor(options = {}) {
    const {
      loadWorkflowTemplate,
      saveWorkflowTemplate,
      RunnerClass = WorkflowRunner,
    } = options;

    this.RunnerClass = RunnerClass;
    this.loadWorkflowTemplateFn = loadWorkflowTemplate;
    this.saveWorkflowTemplateFn = saveWorkflowTemplate;

    // Fallback in-memory registry for templates if no external storage is used.
    this.registry = new Map();
  }

  /**
   * Register a workflow template in-memory.
   * Returns a generated workflowId if one is not provided.
   *
   * @param {Object} template - Workflow JSON template
   * @param {string} [workflowId] - Optional explicit id
   * @returns {Promise<string>} workflowId
   */
  async registerWorkflow(template, workflowId) {
    const requiredParameters = Array.from(extractParameterNames(template));
    const id = workflowId || this._generateId();

    this.registry.set(id, { template, requiredParameters });

    if (this.saveWorkflowTemplateFn) {
      await this.saveWorkflowTemplateFn(id, template, requiredParameters);
    }

    return id;
  }

  /**
   * Get required parameter names for a workflow.
   *
   * @param {string} workflowId
   * @returns {Promise<string[]>}
   */
  async getRequiredParameters(workflowId) {
    const { template, requiredParameters } = await this._loadTemplateAndParams(workflowId);

    if (requiredParameters && Array.isArray(requiredParameters)) {
      return requiredParameters;
    }

    // Fallback: compute from template if not stored
    return Array.from(extractParameterNames(template));
  }

  /**
   * Execute a workflow by id with user-provided parameters.
   *
   * @param {string} workflowId
   * @param {Object} userParameters
   * @param {Object} [options]
   * @param {Object} [options.initialData]
   * @param {Object} [options.tokens]
   * @param {Object} [options.tokenMapping]
   * @returns {Promise<Object>} Execution result from WorkflowRunner
   */
  async executeWorkflow(
    workflowId,
    userParameters = {},
    { initialData = {}, tokens = {}, tokenMapping = {} } = {},
  ) {
    const { template } = await this._loadTemplateAndParams(workflowId);

    const requiredParams = Array.from(extractParameterNames(template));
    const missing = requiredParams.filter(
      (name) => !Object.prototype.hasOwnProperty.call(userParameters, name),
    );

    if (missing.length > 0) {
      const error = new Error('Missing parameters for workflow execution');
      error.code = 'MISSING_PARAMETERS';
      error.missing = missing;
      throw error;
    }

    const injectedWorkflow = injectParameters(template, userParameters);
    
    // Ensure workflow has proper structure (connections defaults to {} if missing/null)
    if (!injectedWorkflow.connections || typeof injectedWorkflow.connections !== 'object') {
      injectedWorkflow.connections = {};
    }
    
    // Ensure nodes array exists
    if (!Array.isArray(injectedWorkflow.nodes)) {
      throw new Error('Workflow must have a nodes array');
    }

    const runner = new this.RunnerClass();
    return runner.execute(injectedWorkflow, initialData, tokens, tokenMapping);
  }

  /**
   * Internal helper to load template and any precomputed required parameters.
   *
   * @private
   * @param {string} workflowId
   * @returns {Promise<{template: Object, requiredParameters?: string[]}>}
   */
  async _loadTemplateAndParams(workflowId) {
    // 1) Prefer external loader if provided
    if (this.loadWorkflowTemplateFn) {
      const loaded = await this.loadWorkflowTemplateFn(workflowId);
      if (!loaded) {
        throw new Error(`Workflow template not found for id: ${workflowId}`);
      }

      // Allow either plain template or { template, requiredParameters }
      if (loaded.template) {
        return {
          template: loaded.template,
          requiredParameters: loaded.requiredParameters,
        };
      }

      return { template: loaded, requiredParameters: undefined };
    }

    // 2) Fallback to in-memory registry
    const entry = this.registry.get(workflowId);
    if (!entry) {
      throw new Error(`Workflow template not found in registry for id: ${workflowId}`);
    }
    return entry;
  }

  /**
   * Generate a simple unique id for in-memory registration.
   *
   * @private
   * @returns {string}
   */
  _generateId() {
    return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

module.exports = WorkflowService;


