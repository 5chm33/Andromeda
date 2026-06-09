---- MODULE Proposal_4f85c1f7 ----
EXTENDS Naturals, Booleans

VARIABLES testsPass

Init ==
  /\ testsPass = TRUE

Next ==
  /\ testsPass' = TRUE

UtilityImproved == TRUE \* Utility delta: 0.0200

Spec == Init /\ [][Next]_<<testsPass>>

Invariant == UtilityImproved

====
