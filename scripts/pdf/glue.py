import re, sys
# 飞书 PDF 导出丢空格:只修自然语言里粘连的英文短语,Java 标识符保持原样
PHRASES = {
    "AIAgent": "AI Agent", "QueryRewrite": "Query Rewrite", "HitRate": "Hit Rate", "TreeofThoughts": "Tree of Thoughts",
    "RouterAgent": "Router Agent", "Human-in-the-loopAgent": "Human-in-the-loop Agent", "ChunkOverlap": "Chunk Overlap",
    "CohereEmbed": "Cohere Embed", "ConversationalRAG": "Conversational RAG", "AgenticRAG": "Agentic RAG",
    "GraphRAG": "GraphRAG", "HybridRAG": "Hybrid RAG", "CorrectiveRAG": "Corrective RAG", "AdvancedRAG": "Advanced RAG",
    "ModelContextProtocol": "Model Context Protocol", "MCPHost": "MCP Host", "MCPClient": "MCP Client", "MCPServer": "MCP Server",
    "FunctionCalling": "Function Calling", "AgenttoAgent": "Agent to Agent", "Server-SentEvents": "Server-Sent Events",
    "SentEvents": "Sent Events", "TokenCost": "Token Cost", "ToolCall": "Tool Call", "ElasticsearchVector": "Elasticsearch Vector",
    "CompareandSwap": "Compare and Swap", "CompareAndSwap": "Compare And Swap", "MethodArea": "Method Area",
    "PermGenspace": "PermGen space", "YoungGeneration": "Young Generation", "OldGeneration": "Old Generation",
    "ProgramCounterRegister": "Program Counter Register", "NativeMethodStack": "Native Method Stack",
    "GenerationalGC": "Generational GC", "NativeMemory": "Native Memory", "StrongReference": "Strong Reference",
    "SoftReference": "Soft Reference", "WeakReference": "Weak Reference", "PhantomReference": "Phantom Reference",
    "SerialGarbageCollector": "Serial Garbage Collector", "ParallelGarbageCollector": "Parallel Garbage Collector",
    "ConcurrentMark-Sweep": "Concurrent Mark-Sweep", "G1GarbageCollector": "G1 Garbage Collector",
    "ZGarbageCollector": "Z Garbage Collector", "GarbageCollector": "Garbage Collector", "BootstrapClassLoader": "Bootstrap ClassLoader",
    "ExtensionClassLoader": "Extension ClassLoader", "SystemClassLoader": "System ClassLoader", "JavaFlightRecorder": "Java Flight Recorder",
    "JMXexporter": "JMX exporter", "NewRelic": "New Relic", "MarkWord": "Mark Word", "ClassPointer": "Class Pointer",
    "MemoryAnalyzerTool": "Memory Analyzer Tool", "TimedWaiting": "Timed Waiting", "VirtualThreads": "Virtual Threads",
    "FullGC": "Full GC", "YoungGC": "Young GC", "MinorGC": "Minor GC", "OldGC": "Old GC",
    "PlanandExecute": "Plan-and-Execute", "Plan-and-Execute": "Plan-and-Execute", "PromptEngineering": "Prompt Engineering",
    "ContextEngineering": "Context Engineering", "GradientAccumulation": "Gradient Accumulation",
    "GradientCheckpoint": "Gradient Checkpoint", "RewardModel": "Reward Model", "PromptInjection": "Prompt Injection",
    "LongTermMemory": "Long Term Memory", "ShortTermMemory": "Short Term Memory", "SystemPrompt": "System Prompt",
    "PromptGuard": "Prompt Guard", "KnowledgeGraph": "Knowledge Graph", "VectorDB": "Vector DB", "TopK": "Top-K",
}
# 代码片段里常见的关键字粘连:public class X / return new X / throws X
CODE_GLUE = [
    (r"\bpublicclass(?=[A-Z])", "public class "), (r"\bclass(?=[A-Z]\w*(?:extends|implements))", "class "),
    (r"(?<=[a-z0-9])extends(?=[A-Z])", " extends "), (r"(?<=[a-z0-9])implements(?=[A-Z])", " implements "),
    (r"\breturnnew(?=[A-Z])", "return new "), (r"\breturn(?=[a-zA-Z]+[A-Z(])(?!s\b)", "return "),
    (r"\bthrows(?=[A-Z])", "throws "), (r"\bnew(?=[A-Z][a-zA-Z]*\()", "new "), (r"\bOverrideprotected(?=[A-Z])", "Override protected "),
    (r"\bOverridepublic(?=[A-Z])", "Override public "), (r"\bpublicString(?=[a-z])", "public String "),
    (r"\b(String|Integer|DataSource|ExecutorService|MyThread)(?=[a-z][A-Za-z]*\b)", r"\1 "),
    (r"\bInterruptedExceptione\b", "InterruptedException e"),
]
for f in sys.argv[1:]:
    s = open(f, encoding="utf-8").read()
    parts = re.split(r"(```.*?```)", s, flags=re.S)
    for i in range(0, len(parts), 2):  # 只改代码块外
        t = parts[i]
        for k in sorted(PHRASES, key=len, reverse=True):
            t = re.sub(rf"(?<![A-Za-z]){re.escape(k)}(?![a-z])", PHRASES[k], t)
        for pat, rep in CODE_GLUE:
            t = re.sub(pat, rep, t)
        parts[i] = t
    open(f, "w", encoding="utf-8").write("".join(parts))
