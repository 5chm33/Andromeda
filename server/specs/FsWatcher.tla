
--------------------------- MODULE FsWatcher ---------------------------
EXTENDS Integers, Sequences, TLC

CONSTANTS MaxQueueSize

VARIABLES queueSize, isProcessing, memoryLeak

vars == <<queueSize, isProcessing, memoryLeak>>

Init ==
    /\ queueSize = 0
    /\ isProcessing = FALSE
    /\ memoryLeak = FALSE

FileEvent ==
    /\ queueSize < MaxQueueSize
    /\ queueSize' = queueSize + 1
    /\ UNCHANGED <<isProcessing, memoryLeak>>

DropEvent ==
    /\ queueSize = MaxQueueSize
    /\ UNCHANGED vars

ProcessStart ==
    /\ queueSize > 0
    /\ isProcessing = FALSE
    /\ isProcessing' = TRUE
    /\ UNCHANGED <<queueSize, memoryLeak>>

ProcessComplete ==
    /\ isProcessing = TRUE
    /\ isProcessing' = FALSE
    /\ queueSize' = queueSize - 1
    /\ UNCHANGED memoryLeak

DetectLeak ==
    /\ queueSize > MaxQueueSize
    /\ memoryLeak' = TRUE
    /\ UNCHANGED <<queueSize, isProcessing>>

Next == FileEvent \/ DropEvent \/ ProcessStart \/ ProcessComplete \/ DetectLeak

\* INVARIANTS
BoundedQueue == queueSize <= MaxQueueSize
NoMemoryLeak == memoryLeak = FALSE

=========================================================================
