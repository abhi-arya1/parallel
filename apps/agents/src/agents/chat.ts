import { Agent, type Connection, type WSMessage } from 'agents';
import { createGateway } from '@ai-sdk/gateway';
import { generateText, streamText } from 'ai';

export type Message = {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
};

export type ChatState = {
	messages: Message[];
	metadata: Record<string, unknown>;
	currentWorkflowId?: string;
};

export class ChatAgent extends Agent<Env, ChatState> {
	initialState: ChatState = {
		messages: [],
		metadata: {},
	};

	// Create the AI Gateway client
	private getGateway() {
		return createGateway({
			baseURL: 'https://gateway.ai.cloudflare.com/v1',
		});
	}

	/**
	 * Convert messages to AI SDK format
	 */
	private toModelMessages() {
		return this.state.messages.map((msg) => ({
			role: msg.role as 'user' | 'assistant' | 'system',
			content: msg.content,
		}));
	}

	// ============================================
	// WebSocket Handlers
	// ============================================

	onConnect(connection: Connection): void {
		console.log(`Client connected: ${connection.id}`);
		connection.send(
			JSON.stringify({
				type: 'state',
				state: this.state,
			}),
		);
	}

	onDisconnect(connection: Connection): void {
		console.log(`Client disconnected: ${connection.id}`);
	}

	async onMessage(connection: Connection, message: WSMessage): Promise<void> {
		if (typeof message !== 'string') {
			console.warn('Received non-string message');
			return;
		}

		try {
			const data = JSON.parse(message);

			switch (data.type) {
				case 'chat':
					await this.handleChatMessage(connection, data.content);
					break;
				case 'stream':
					await this.handleStreamMessage(connection, data.content);
					break;
				case 'workflow':
					await this.handleWorkflowMessage(connection, data);
					break;
				case 'clear':
					this.clearMessages();
					break;
				default:
					console.warn(`Unknown message type: ${data.type}`);
			}
		} catch (error) {
			console.error('Failed to parse message:', error);
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'Invalid message format',
				}),
			);
		}
	}

	// ============================================
	// Chat Handlers
	// ============================================

	private async handleChatMessage(connection: Connection, content: string): Promise<void> {
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content,
		};

		this.setState({
			...this.state,
			messages: [...this.state.messages, userMessage],
		});

		try {
			const gateway = this.getGateway();

			const { text } = await generateText({
				model: gateway('openai/gpt-4o-mini'),
				messages: this.toModelMessages(),
			});

			const assistantMessage: Message = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: text,
			};

			this.setState({
				...this.state,
				messages: [...this.state.messages, assistantMessage],
			});

			connection.send(
				JSON.stringify({
					type: 'message',
					message: assistantMessage,
				}),
			);
		} catch (error) {
			console.error('AI generation failed:', error);
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'Failed to generate response',
				}),
			);
		}
	}

	private async handleStreamMessage(connection: Connection, content: string): Promise<void> {
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content,
		};

		this.setState({
			...this.state,
			messages: [...this.state.messages, userMessage],
		});

		const messageId = crypto.randomUUID();

		try {
			const gateway = this.getGateway();

			const result = streamText({
				model: gateway('openai/gpt-4o-mini'),
				messages: this.toModelMessages(),
			});

			connection.send(
				JSON.stringify({
					type: 'stream-start',
					messageId,
				}),
			);

			let fullContent = '';

			for await (const chunk of result.textStream) {
				fullContent += chunk;
				connection.send(
					JSON.stringify({
						type: 'stream-chunk',
						messageId,
						chunk,
					}),
				);
			}

			const assistantMessage: Message = {
				id: messageId,
				role: 'assistant',
				content: fullContent,
			};

			this.setState({
				...this.state,
				messages: [...this.state.messages, assistantMessage],
			});

			connection.send(
				JSON.stringify({
					type: 'stream-end',
					messageId,
					message: assistantMessage,
				}),
			);
		} catch (error) {
			console.error('AI streaming failed:', error);
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'Failed to stream response',
				}),
			);
		}
	}

	// ============================================
	// Workflow Handlers (using base class methods)
	// ============================================

	private async handleWorkflowMessage(
		connection: Connection,
		data: {
			action: string;
			workflowId?: string;
			params?: { model?: string; systemPrompt?: string };
		},
	): Promise<void> {
		switch (data.action) {
			case 'start':
				await this.startChatWorkflow(connection, data.params);
				break;
			case 'status':
				await this.checkWorkflowStatus(connection, data.workflowId);
				break;
			default:
				connection.send(
					JSON.stringify({
						type: 'error',
						error: `Unknown workflow action: ${data.action}`,
					}),
				);
		}
	}

	private async startChatWorkflow(connection: Connection, params?: { model?: string; systemPrompt?: string }): Promise<void> {
		try {
			// Use the base class runWorkflow method
			const workflowId = await this.runWorkflow('CHAT_WORKFLOW', {
				messages: this.state.messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				model: params?.model || 'openai/gpt-4o-mini',
				systemPrompt: params?.systemPrompt,
			});

			this.setState({
				...this.state,
				currentWorkflowId: workflowId,
			});

			connection.send(
				JSON.stringify({
					type: 'workflow-started',
					workflowId,
				}),
			);

			// Poll for completion
			this.pollWorkflow(connection, workflowId);
		} catch (error) {
			console.error('Failed to start workflow:', error);
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'Failed to start workflow',
				}),
			);
		}
	}

	private async pollWorkflow(connection: Connection, workflowId: string): Promise<void> {
		try {
			// Use the base class getWorkflowStatus method
			const status = await this.getWorkflowStatus('CHAT_WORKFLOW', workflowId);

			if (status.status === 'running') {
				setTimeout(() => this.pollWorkflow(connection, workflowId), 1000);
				return;
			}

			if (status.status === 'complete' && status.output) {
				const output = status.output as { response?: string };
				if (output.response) {
					const assistantMessage: Message = {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: output.response,
					};

					this.setState({
						...this.state,
						messages: [...this.state.messages, assistantMessage],
						currentWorkflowId: undefined,
					});

					connection.send(
						JSON.stringify({
							type: 'workflow-complete',
							workflowId,
							message: assistantMessage,
						}),
					);
				}
			} else {
				this.setState({
					...this.state,
					currentWorkflowId: undefined,
				});

				connection.send(
					JSON.stringify({
						type: 'workflow-failed',
						workflowId,
						error: status.error || 'Workflow failed',
					}),
				);
			}
		} catch (error) {
			console.error('Failed to poll workflow:', error);
		}
	}

	private async checkWorkflowStatus(connection: Connection, workflowId?: string): Promise<void> {
		const id = workflowId || this.state.currentWorkflowId;
		if (!id) {
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'No active workflow',
				}),
			);
			return;
		}

		try {
			const status = await this.getWorkflowStatus('CHAT_WORKFLOW', id);

			connection.send(
				JSON.stringify({
					type: 'workflow-status',
					workflowId: id,
					status: status.status,
					output: status.output,
					error: status.error,
				}),
			);
		} catch (error) {
			connection.send(
				JSON.stringify({
					type: 'error',
					error: 'Workflow not found',
				}),
			);
		}
	}

	// ============================================
	// RPC Methods
	// ============================================

	async sendMessage(content: string): Promise<Message> {
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content,
		};

		this.setState({
			...this.state,
			messages: [...this.state.messages, userMessage],
		});

		const gateway = this.getGateway();

		const { text } = await generateText({
			model: gateway('openai/gpt-4o-mini'),
			messages: this.toModelMessages(),
		});

		const assistantMessage: Message = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: text,
		};

		this.setState({
			...this.state,
			messages: [...this.state.messages, assistantMessage],
		});

		this.broadcast(
			JSON.stringify({
				type: 'message',
				message: assistantMessage,
			}),
		);

		return assistantMessage;
	}

	getMessages(): Message[] {
		return this.state.messages;
	}

	clearMessages(): void {
		this.setState({
			...this.state,
			messages: [],
			currentWorkflowId: undefined,
		});

		this.broadcast(
			JSON.stringify({
				type: 'state',
				state: this.state,
			}),
		);
	}

	setMetadata(key: string, value: unknown): void {
		this.setState({
			...this.state,
			metadata: {
				...this.state.metadata,
				[key]: value,
			},
		});
	}

	async executeWorkflow(params?: { model?: string; systemPrompt?: string }): Promise<string> {
		const workflowId = await this.runWorkflow('CHAT_WORKFLOW', {
			messages: this.state.messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			model: params?.model || 'openai/gpt-4o-mini',
			systemPrompt: params?.systemPrompt,
		});

		this.setState({
			...this.state,
			currentWorkflowId: workflowId,
		});

		return workflowId;
	}
}
