"""Pydantic models for task payloads and results."""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str
    content: str | None = None
    toolCalls: list[dict] | None = None
    toolCallId: str | None = None
    name: str | None = None


class ToolCallFunction(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    type: str = "function"
    function: ToolCallFunction


class QueueTask(BaseModel):
    taskId: str
    conversationId: str
    workspaceId: str
    userId: str
    department: str
    model: str
    messages: list[dict]
    tools: list[dict] | None = None
    systemPrompt: str
    createdAt: str


class TaskResult(BaseModel):
    answer: str
    thinking: str | None = None
    sources: list[dict] | None = None
    confidence: float | None = None
    needsEscalation: bool = False
    suggestedDepartment: str | None = None
    ticketId: str | None = None
    conversationId: str = ""
    error: str | None = None


class ToolExecutionRequest(BaseModel):
    taskId: str
    toolCall: dict
    session: dict


class ToolExecutionResponse(BaseModel):
    messages: list[dict]
    summary: str
    taskId: str | None = None
