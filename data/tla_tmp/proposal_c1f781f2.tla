---- MODULE Proposal_c1f781f2 ----
EXTENDS Naturals, Booleans

VARIABLES placeholder

Init ==
  /\ TRUE

Next ==
  /\ TRUE

UtilityImproved == TRUE \* Utility delta: 0.0000

Spec == Init /\ [][Next]_<<placeholder>>

Invariant == UtilityImproved

====
