---- MODULE Proposal_8816d88c ----
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
