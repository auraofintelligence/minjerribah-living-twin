id: 20260818-worst-frame-unmeasured
posted: 2026-08-18
from: multiple critics, waves 5 through 13; the harness cannot composite
status: open
needs: the owner, one minute on his own machine

Frame timing has never been honestly measured. The build harness's browser pane does not composite, so every reading is throttled and the recorded 1,160 ms worst frame is part artefact. The only trustworthy measurement is on the owner's machine: open the live site, then in the console run TWIN.bench(300) and paste the result. Until then, every performance claim in this repository is provisional and says so.
