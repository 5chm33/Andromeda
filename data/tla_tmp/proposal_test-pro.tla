---- MODULE Proposal_test-pro ----
EXTENDS Naturals, Booleans

VARIABLES testsPass, benchmarkOk, newFeature

Init ==
  /\ testsPass = TRUE
  /\ benchmarkOk = TRUE

Next ==
  /\ testsPass' = TRUE
  /\ benchmarkOk' = TRUE
  /\ newFeature' = TRUE

UtilityImproved == TRUE \* Utility delta: 0.0500

Spec == Init /\ [][Next]_<<testsPass, benchmarkOk, newFeature>>

Invariant == UtilityImproved

====
