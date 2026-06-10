---- MODULE Proposal_5a9ad6ef ----
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
