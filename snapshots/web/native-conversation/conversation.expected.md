User
Native browser input.
image.png
Assistant
{
  "type": "tool-call",
  "id": "human-0",
  "name": "guarded",
  "arguments": "{}"
}
Tool
{
  "type": "tool-result",
  "toolCallId": "human-0",
  "content": [
    {
      "type": "text",
      "text": "guarded allowed"
    }
  ],
  "isError": false
}
Assistant
{
  "type": "tool-call",
  "id": "human-1",
  "name": "guarded",
  "arguments": "{}"
}
Tool
{
  "type": "tool-result",
  "toolCallId": "human-1",
  "content": [
    {
      "type": "text",
      "text": "native-headless: tool guarded approval rejected"
    }
  ],
  "isError": true
}
Assistant
{
  "type": "tool-call",
  "id": "human-2",
  "name": "ask_user_question",
  "arguments": "{\"questions\":[{\"id\":\"mode\",\"question\":\"Choose mode\",\"options\":[{\"label\":\"One\"},{\"label\":\"Two\"}]}]}"
}
Tool
{
  "type": "tool-result",
  "toolCallId": "human-2",
  "content": [
    {
      "type": "text",
      "text": "{\"answers\":[{\"id\":\"mode\",\"selected\":[\"Two\"]}]}"
    }
  ],
  "isError": false
}
Assistant
{
  "type": "tool-call",
  "id": "human-3",
  "name": "todo_write",
  "arguments": "{\"todos\":[{\"content\":\"Inspect the workspace\",\"status\":\"completed\"},{\"content\":\"Report progress\",\"status\":\"in_progress\"}]}"
}
Tool
{
  "type": "tool-result",
  "toolCallId": "human-3",
  "content": [
    {
      "type": "text",
      "text": "Updated todo list: 0 pending, 1 in progress, 1 completed."
    }
  ],
  "isError": false
}
Assistant
Native browser answer.
