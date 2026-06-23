
--------------------------- MODULE InitSafety ---------------------------
EXTENDS Integers, Sequences, TLC

VARIABLES state, bootCount, crashCount, rollbackTriggered

vars == <<state, bootCount, crashCount, rollbackTriggered>>

Init ==
    /\ state = "stopped"
    /\ bootCount = 0
    /\ crashCount = 0
    /\ rollbackTriggered = FALSE

Boot ==
    /\ state = "stopped"
    /\ state' = "running"
    /\ bootCount' = bootCount + 1
    /\ UNCHANGED <<crashCount, rollbackTriggered>>

CleanShutdown ==
    /\ state = "running"
    /\ state' = "stopped"
    /\ crashCount' = 0
    /\ UNCHANGED <<bootCount, rollbackTriggered>>

Crash ==
    /\ state = "running"
    /\ state' = "stopped"
    /\ crashCount' = crashCount + 1
    /\ UNCHANGED <<bootCount, rollbackTriggered>>

TriggerRollback ==
    /\ crashCount >= 3
    /\ rollbackTriggered = FALSE
    /\ rollbackTriggered' = TRUE
    /\ crashCount' = 0
    /\ UNCHANGED <<state, bootCount>>

Next == Boot \/ CleanShutdown \/ Crash \/ TriggerRollback

\* INVARIANTS
SafetyInvariant == crashCount <= 3
LivenessInvariant == [](crashCount >= 3 => <>rollbackTriggered)

=========================================================================
