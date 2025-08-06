# tella
Tella is the brain that converts your intent into on-chain results

## The first version would capture "txt2pay" -- a P2P payments via txt msgs.

### See Idea below: 

#### No App, No Wallet, No Friction

Acronyms:

Txt = text message

& = carbon copying

Tella = a special mobile ph number for a backend service 

```
A txt B - Hey B, I’m low on money. Can you spot me 10 bucks? 

B txt A - Sure. 

B txt Tella - Send $10 bucks to <A's mobile #>

If wallet exists for B 
Tella txt B - Confirm, you are sending $10 to A
B txt Tella - Yes
Tella txt B - Sent

If wallet does not exist for B
Tella txt B - Help link your bank to fund your wallet via [ plaid link to connect wallet to bank ] 
B txt Tella - Done
Tella txt B - Confirm you are sending $10 to A
B txt Tella - Yes
Tella txt B - Sent

If wallet exists for A
Tella txt A - B sent you $10 bucks

If wallet does not exist for A 
Tella txt A - B sent you $10, accept via linking wallet to bank [ plaid link ]
